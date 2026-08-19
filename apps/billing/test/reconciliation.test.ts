// Agent-authored (SOL consult refused: "Selected model is at capacity" on two
// distinct healthy Codewith accounts — no SOL opinion was produced for this repo).
//
// Accounting-reconciliation edge cases: the (source, source_id, event_type)
// upsert semantics — including the subtle re-emit-after-written behavior where
// the entry ref survives but the state resets — and not-found paths. A
// regression here means duplicate accounting entries or lost writeback refs
// (money recorded twice or never reconciled).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { freshDb, systemContext, TEST_ENTITY_A, TEST_ENTITY_B } from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import { emitAccountingReconciliation } from "../src/services/reconciliation.js";
import { getOp } from "../src/services/registry.js";
import { runOp, type ServiceContext } from "../src/services/context.js";
import { MockStripeAdapter, setStripeAdapter } from "../src/adapters/stripe.js";
import type { AccountingReconciliationRow } from "../src/types/index.js";
import type { Database } from "bun:sqlite";

async function call(ctx: ServiceContext, opName: string, input: unknown): Promise<unknown> {
  const op = getOp(opName);
  if (!op) throw new Error(`no op ${opName}`);
  return runOp(op, ctx, input);
}

let db: Database;
let ctx: ServiceContext;

beforeEach(() => {
  db = freshDb();
  const mock = new MockStripeAdapter();
  setStripeAdapter(mock);
  ctx = systemContext(db);
  ctx.stripe = mock;
});
afterEach(() => {
  setStripeAdapter(null);
  closeDatabase();
});

function rows(): AccountingReconciliationRow[] {
  return db.query("SELECT * FROM accounting_reconciliation_events ORDER BY created_at").all() as AccountingReconciliationRow[];
}

describe("upsert semantics on (source, source_id, event_type)", () => {
  it("keeps a single row when the same key is emitted twice (amount is first-write-wins)", () => {
    const key = { entity_id: TEST_ENTITY_A, source: "stripe" as const, source_id: "in_1", event_type: "invoice.paid", amount: 2500, currency: "usd" };
    emitAccountingReconciliation(db, "actor-1", key);
    emitAccountingReconciliation(db, "actor-1", { ...key, amount: 3000 });
    expect(rows()).toHaveLength(1);
    // The upsert DO UPDATE set excludes amount/currency — the original event's
    // figures survive a redelivery, which is the correct semantics for an
    // idempotent webhook replay.
    expect(rows()[0]).toMatchObject({ source_id: "in_1", event_type: "invoice.paid", amount: 2500, state: "pending" });
  });

  it("preserves the accounting_entry_ref across a re-emit but resets state to pending (excluded.state wins)", async () => {
    const key = { entity_id: TEST_ENTITY_A, source: "stripe" as const, source_id: "in_2", event_type: "invoice.paid", amount: 1000, currency: "usd" };
    const first = emitAccountingReconciliation(db, "actor-1", key);
    const written = (await call(ctx, "mark_accounting_reconciliation_written", {
      id: first.id,
      accounting_entry_ref: "acct-entry-1",
    })) as AccountingReconciliationRow;
    expect(written.state).toBe("written");

    // Same stripe event re-delivered (retry of the webhook) — the ref must
    // survive, and the row must be pending again so accounting sees it.
    emitAccountingReconciliation(db, "actor-1", key);
    const after = rows();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ accounting_entry_ref: "acct-entry-1", state: "pending" });
  });

  it("replaces the accounting_entry_ref when the re-emit carries a new one", async () => {
    const key = { entity_id: TEST_ENTITY_A, source: "stripe" as const, source_id: "in_3", event_type: "invoice.paid", amount: 1000, currency: "usd" };
    const first = emitAccountingReconciliation(db, "actor-1", key);
    await call(ctx, "mark_accounting_reconciliation_written", { id: first.id, accounting_entry_ref: "old-ref" });
    emitAccountingReconciliation(db, "actor-1", { ...key, accounting_entry_ref: "new-ref" });
    const after = rows();
    expect(after).toHaveLength(1);
    expect(after[0]!.accounting_entry_ref).toBe("new-ref");
  });
});

describe("not-found and filter paths", () => {
  it("fails with RECONCILIATION_NOT_FOUND when marking a missing row written", async () => {
    await expect(call(ctx, "mark_accounting_reconciliation_written", { id: "nope", accounting_entry_ref: "ref" })).rejects.toMatchObject({
      code: "RECONCILIATION_NOT_FOUND",
    });
  });

  it("fails with RECONCILIATION_NOT_FOUND for a missing get", async () => {
    await expect(call(ctx, "get_accounting_reconciliation", { id: "nope" })).rejects.toMatchObject({
      code: "RECONCILIATION_NOT_FOUND",
    });
  });

  it("filters list by state and source", async () => {
    const key = { entity_id: TEST_ENTITY_A, source: "stripe" as const, source_id: "in_4", event_type: "invoice.paid", amount: 1000, currency: "usd" };
    const row = emitAccountingReconciliation(db, "actor-1", key);
    emitAccountingReconciliation(db, "actor-1", { ...key, source_id: "in_5", event_type: "charge.refunded" });
    await call(ctx, "mark_accounting_reconciliation_written", { id: row.id, accounting_entry_ref: "ref-4" });

    const pending = (await call(ctx, "list_accounting_reconciliation", { entity_id: TEST_ENTITY_A, state: "pending" })) as AccountingReconciliationRow[];
    expect(pending.map((r) => r.event_type)).toEqual(["charge.refunded"]);
    const stripe = (await call(ctx, "list_accounting_reconciliation", { entity_id: TEST_ENTITY_A, source: "stripe" })) as AccountingReconciliationRow[];
    expect(stripe).toHaveLength(2);
    const written = (await call(ctx, "list_accounting_reconciliation", { entity_id: TEST_ENTITY_A, state: "written" })) as AccountingReconciliationRow[];
    expect(written.map((r) => r.event_type)).toEqual(["invoice.paid"]);
  });
});
