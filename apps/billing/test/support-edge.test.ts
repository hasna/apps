// Sol-guided coverage (tests-coverage-sol workflow, 2026-08-19).
//
// Priority 4 — operator support snapshots: missing customers are rejected,
// a valid empty-history snapshot returns empty collections, the webhook
// events list is capped at 20 and the accounting reconciliation list at 50,
// and cross-entity access is denied for a non-bypass principal.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { freshDb, systemContext, TEST_ENTITY_A, TEST_ENTITY_B } from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import { getOp } from "../src/services/registry.js";
import { runOp, makeContext, type ServiceContext } from "../src/services/context.js";
import { MockStripeAdapter, setStripeAdapter } from "../src/adapters/stripe.js";
import { eventSignedPayload } from "../src/services/events.js";
import { emitAccountingReconciliation } from "../src/services/reconciliation.js";
import type { CustomerRow } from "../src/types/index.js";

async function call(ctx: ServiceContext, opName: string, input: unknown): Promise<unknown> {
  const op = getOp(opName);
  if (!op) throw new Error(`no op ${opName}`);
  return runOp(op, ctx, input);
}

const WEBHOOK_SECRET = "whsec_test_support_edge";

let ctx: ServiceContext;
let mock: MockStripeAdapter;

function signEvent(input: { stripe_event_id: string; type: string; payload?: Record<string, unknown> }): string {
  return mock.signWebhook(eventSignedPayload(input), WEBHOOK_SECRET);
}

beforeEach(() => {
  const db = freshDb();
  mock = new MockStripeAdapter();
  setStripeAdapter(mock);
  ctx = systemContext(db);
  ctx.stripe = mock;
  process.env["HASNA_BILLING_STRIPE_WEBHOOK_SECRET"] = WEBHOOK_SECRET;
});
afterEach(() => {
  setStripeAdapter(null);
  delete process.env["HASNA_BILLING_STRIPE_WEBHOOK_SECRET"];
  closeDatabase();
});

describe("support snapshot guards", () => {
  it("rejects a missing customer with CUSTOMER_NOT_FOUND", async () => {
    await expect(call(ctx, "get_support_customer_snapshot", { customer_id: "nope" })).rejects.toMatchObject({
      code: "CUSTOMER_NOT_FOUND",
    });
  });

  it("returns a valid empty-history snapshot", async () => {
    const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "empty@example.com" })) as CustomerRow;
    const snapshot = (await call(ctx, "get_support_customer_snapshot", { customer_id: customer.id })) as {
      customer: CustomerRow;
      subscriptions: unknown[];
      invoices: unknown[];
      dunning_runs: unknown[];
      webhook_events: unknown[];
      accounting_reconciliation: unknown[];
      customer_portal: { handoff_available: boolean; stripe_customer_id: string | null };
    };
    expect(snapshot.customer.id).toBe(customer.id);
    expect(snapshot.subscriptions).toEqual([]);
    expect(snapshot.invoices).toEqual([]);
    expect(snapshot.dunning_runs).toEqual([]);
    expect(snapshot.webhook_events).toEqual([]);
    expect(snapshot.accounting_reconciliation).toEqual([]);
    expect(snapshot.customer_portal.handoff_available).toBe(true);
    expect(snapshot.customer_portal.stripe_customer_id).toBe(customer.stripe_customer_id);
  });

  it("caps webhook events at 20 in the snapshot", async () => {
    const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "events@example.com" })) as CustomerRow;
    for (let i = 0; i < 25; i++) {
      const body = { stripe_event_id: `evt_support_${i}`, type: "charge.succeeded", payload: { id: `ch_${i}`, amount: 100, created: 100 + i } };
      await call(ctx, "ingest_event", { entity_id: TEST_ENTITY_A, ...body, signature: signEvent(body) });
    }
    const snapshot = (await call(ctx, "get_support_customer_snapshot", { customer_id: customer.id })) as {
      webhook_events: unknown[];
    };
    expect(snapshot.webhook_events).toHaveLength(20);
  });

  it("caps accounting reconciliation at 50 in the snapshot", async () => {
    const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "recon@example.com" })) as CustomerRow;
    for (let i = 0; i < 60; i++) {
      emitAccountingReconciliation(ctx.db, "actor-1", {
        entity_id: TEST_ENTITY_A,
        source: "stripe",
        source_id: `in_support_${i}`,
        event_type: "invoice.paid",
        amount: 100,
        currency: "usd",
      });
    }
    const snapshot = (await call(ctx, "get_support_customer_snapshot", { customer_id: customer.id })) as {
      accounting_reconciliation: unknown[];
    };
    expect(snapshot.accounting_reconciliation).toHaveLength(50);
  });

  it("rejects cross-entity access for a non-bypass principal", async () => {
    // Customer lives in entity B.
    const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_B, email: "foreign@example.com" })) as CustomerRow;
    // Principal scoped only to entity A.
    const scopedCtx = makeContext(ctx.db, { actor_id: "agent-a", roles: ["admin"], entity_ids: [TEST_ENTITY_A] });
    await expect(
      call(scopedCtx, "get_support_customer_snapshot", { customer_id: customer.id }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
