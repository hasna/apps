// Sol-guided coverage (tests-coverage-sol workflow, 2026-08-19).
//
// Priority 2 — dunning state machine coverage not present in the golden
// flows: invoice attempt_count increments on each executed charge attempt
// (and not on short-circuits), list_dunning_runs filters by invoice and
// entity, and an unknown decline code with no default rule resolves through
// the hardcoded 24/72 hour schedule end-to-end via a real run.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { freshDb, systemContext, TEST_ENTITY_A, TEST_ENTITY_B } from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import { getOp } from "../src/services/registry.js";
import { runOp, type ServiceContext } from "../src/services/context.js";
import { MockStripeAdapter, setStripeAdapter } from "../src/adapters/stripe.js";
import type { DunningRunRow, InvoiceRow, SubscriptionRow } from "../src/types/index.js";

async function call(ctx: ServiceContext, opName: string, input: unknown): Promise<unknown> {
  const op = getOp(opName);
  if (!op) throw new Error(`no op ${opName}`);
  return runOp(op, ctx, input);
}

let ctx: ServiceContext;
let mock: MockStripeAdapter;

async function seedPastDue(plan = "pro", entity = TEST_ENTITY_A) {
  const customer = (await call(ctx, "create_customer", { entity_id: entity, email: "a@b.com" })) as { id: string };
  const sub = (await call(ctx, "create_subscription", { customer_id: customer.id, plan })) as SubscriptionRow;
  const invoice = (await call(ctx, "create_invoice", { customer_id: customer.id, subscription_id: sub.id, amount_due: 4000 })) as InvoiceRow;
  return { customer, sub, invoice };
}

async function createPolicy(overrides: Record<string, unknown> = {}, entity = TEST_ENTITY_A) {
  return (await call(ctx, "create_dunning_policy", {
    entity_id: entity,
    name: "coverage",
    rules: { card_declined: { retry_offsets_hours: [24], on_exhausted: "mark_uncollectible" } },
    max_attempts: 2,
    ...overrides,
  })) as { id: string };
}

beforeEach(() => {
  const db = freshDb();
  mock = new MockStripeAdapter();
  setStripeAdapter(mock);
  ctx = systemContext(db);
  ctx.stripe = mock;
});
afterEach(() => {
  setStripeAdapter(null);
  closeDatabase();
});

describe("attempt_count accounting", () => {
  it("increments attempt_count on a failed retry and again on a successful one", async () => {
    const { invoice } = await seedPastDue();
    const policy = await createPolicy();
    mock.scriptCharge(invoice.id, [
      { paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" },
      { paid: true, invoice_id: invoice.id, amount: 4000, decline_code: null },
    ]);

    const run1 = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run1.attempt).toBe(1);
    let after1 = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(after1.attempt_count).toBe(1);

    const run2 = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run2.outcome).toBe("retry_succeeded");
    expect(run2.attempt).toBe(2);
    after1 = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(after1.attempt_count).toBe(2);
    expect(after1.status).toBe("paid");
    expect(after1.amount_paid).toBe(4000);
  });

  it("keeps attempt_count at zero on the paid short-circuit (no charge fired)", async () => {
    const { invoice } = await seedPastDue();
    await call(ctx, "mark_invoice_paid", { id: invoice.id });
    const policy = await createPolicy();
    mock.scriptCharge(invoice.id, [{ paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" }]);
    const run = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run.outcome).toBe("canceled");
    const after = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(after.attempt_count).toBe(0);
  });
});

describe("unknown decline code with no default", () => {
  it("falls back to the hardcoded 24/72-hour schedule and marks the invoice uncollectible on exhaustion", async () => {
    const { invoice } = await seedPastDue();
    // No rule for this code and no `default` key in the policy schedule.
    const policy = await createPolicy({ rules: {} });
    mock.scriptCharge(invoice.id, [
      { paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "fraudulent" as never },
      { paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "fraudulent" as never },
    ]);

    const run1 = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run1.outcome).toBe("retry_failed");
    expect(run1.decline_code).toBe("fraudulent");
    // 24/72 fallback schedule: attempt 1 schedules 24h out.
    const offsetHours = (Date.parse(run1.scheduled_at!) - Date.now()) / 3600_000;
    expect(offsetHours).toBeGreaterThan(23);
    expect(offsetHours).toBeLessThan(25);

    const run2 = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run2.outcome).toBe("abandoned"); // exhausted on the 24/72 schedule
    const after = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(after.status).toBe("uncollectible");
    expect(after.attempt_count).toBe(2);
  });
});

describe("run listing", () => {
  it("lists runs filtered by invoice and by entity", async () => {
    const { invoice, sub } = await seedPastDue();
    const policy = await createPolicy();
    mock.scriptCharge(invoice.id, [
      { paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" },
      { paid: true, invoice_id: invoice.id, amount: 4000, decline_code: null },
    ]);
    await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id });
    await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id });

    const byInvoice = (await call(ctx, "list_dunning_runs", { entity_id: TEST_ENTITY_A, invoice_id: invoice.id })) as DunningRunRow[];
    expect(byInvoice).toHaveLength(2);
    expect(byInvoice.map((r) => r.attempt)).toEqual([1, 2]);

    const byEntity = (await call(ctx, "list_dunning_runs", { entity_id: TEST_ENTITY_A })) as DunningRunRow[];
    expect(byEntity).toHaveLength(2);

    // A different entity's filter sees nothing of this run.
    const other = (await call(ctx, "list_dunning_runs", { entity_id: TEST_ENTITY_B })) as DunningRunRow[];
    expect(other).toHaveLength(0);
  });
});
