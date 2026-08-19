// Sol-guided coverage (tests-coverage-sol workflow, 2026-08-19).
//
// Priority 1 measured red regression: re-ingesting the same logical
// accounting-reconciliation tuple (entity, source, source_id, event_type)
// after it was marked `written` MUST NOT silently reset the row back to
// `pending`. The accounting writeback ref is the audit trail for money
// movement; a redelivery of the same Stripe event (webhook retry) losing the
// `written` state means the writeback can be double-emitted downstream. The
// current ON CONFLICT clause sets `state = excluded.state` unconditionally,
// which resets to `pending` on every re-emit — this test pins the corrected
// contract: `written` is sticky.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { freshDb, systemContext, TEST_ENTITY_A } from "./helpers.js";
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

describe("re-emit after written (webhook redelivery)", () => {
  it("keeps the row state 'written' and the accounting_entry_ref unchanged when the same logical event is re-ingested", async () => {
    // One synthetic (entity, source, source_id, event_type) tuple.
    const key = {
      entity_id: TEST_ENTITY_A,
      source: "stripe" as const,
      source_id: "in_redelivery_1",
      event_type: "invoice.paid",
      amount: 2500,
      currency: "usd",
    };

    // First ingest of the Stripe event.
    const first = emitAccountingReconciliation(db, "actor-1", key);

    // Accounting writes the entry back with a stable ref.
    const written = (await call(ctx, "mark_accounting_reconciliation_written", {
      id: first.id,
      accounting_entry_ref: "acct-entry-keep-1",
    })) as AccountingReconciliationRow;
    expect(written.state).toBe("written");
    expect(written.accounting_entry_ref).toBe("acct-entry-keep-1");

    // The same logical event is redelivered (Stripe retried the webhook) with
    // a different event id — the tuple is unchanged, so the upsert fires.
    const replay = emitAccountingReconciliation(db, "actor-1", key);
    expect(replay.id).toBe(first.id); // upsert, not a second row

    // REGRESSION: the writeback state must survive the redelivery. A reset to
    // 'pending' would make accounting re-process money that was already
    // recorded.
    expect(replay.state).toBe("written");
    expect(replay.accounting_entry_ref).toBe("acct-entry-keep-1");

    const rows = db.query("SELECT * FROM accounting_reconciliation_events").all() as AccountingReconciliationRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("written");
    expect(rows[0]!.accounting_entry_ref).toBe("acct-entry-keep-1");
  });

  it("still applies a NEW explicit state from a genuinely new event (pending stays pending)", async () => {
    // Two-sided control: the sticky-written rule must not freeze rows that
    // have never been written back.
    const key = {
      entity_id: TEST_ENTITY_A,
      source: "stripe" as const,
      source_id: "in_sticky_control",
      event_type: "invoice.payment_failed",
      amount: 1200,
      currency: "usd",
    };
    const first = emitAccountingReconciliation(db, "actor-1", key);
    const replay = emitAccountingReconciliation(db, "actor-1", key);
    expect(replay.id).toBe(first.id);
    expect(replay.state).toBe("pending");
  });
});
