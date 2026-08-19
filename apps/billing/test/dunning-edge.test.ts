// Agent-authored (SOL consult refused: "Selected model is at capacity" on two
// distinct healthy Codewith accounts — no SOL opinion was produced for this repo).
//
// Dunning edge cases the golden flows in billing-domain.test.ts do not reach:
// paid/void short-circuit paths (no charge attempted, no attempt_count bump),
// entity-mismatch rejection, max_attempts-vs-schedule boundaries, per-attempt
// retry-offset indexing, every terminal action branch, and decline-code
// resolution precedence. Money movement risk: a regression here means double
// charges, missed retries, or invoices stuck open after retries exhaust.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { freshDb, systemContext, TEST_ENTITY_A, TEST_ENTITY_B } from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import { getOp } from "../src/services/registry.js";
import { runOp, type ServiceContext } from "../src/services/context.js";
import { MockStripeAdapter, setStripeAdapter } from "../src/adapters/stripe.js";
import { ruleForDeclineCode } from "../src/services/dunning.js";
import type { DunningRunRow, InvoiceRow, SubscriptionRow } from "../src/types/index.js";

/** Mock that counts charge attempts so "no Stripe call happened" is asserted, not assumed. */
class CountingStripeAdapter extends MockStripeAdapter {
  retryCalls = 0;
  override async retryInvoicePayment(input: { invoice_id: string; amount: number }): Promise<{
    paid: boolean;
    invoice_id: string;
    amount: number;
    decline_code: import("../src/types/index.js").DeclineCode | null;
  }> {
    this.retryCalls += 1;
    return super.retryInvoicePayment(input);
  }
}

async function call(ctx: ServiceContext, opName: string, input: unknown): Promise<unknown> {
  const op = getOp(opName);
  if (!op) throw new Error(`no op ${opName}`);
  return runOp(op, ctx, input);
}

let ctx: ServiceContext;
let mock: CountingStripeAdapter;

async function seedPastDue(plan: string, opts: { subscription?: boolean } = { subscription: true }) {
  const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "a@b.com" })) as { id: string };
  const sub = (await call(ctx, "create_subscription", { customer_id: customer.id, plan })) as SubscriptionRow;
  const invoice = (await call(ctx, "create_invoice", {
    customer_id: customer.id,
    subscription_id: opts.subscription ? sub.id : undefined,
    amount_due: 4000,
  })) as InvoiceRow;
  return { customer, sub, invoice };
}

async function createPolicy(overrides: Record<string, unknown> = {}) {
  return (await call(ctx, "create_dunning_policy", {
    entity_id: TEST_ENTITY_A,
    name: "edge",
    rules: { card_declined: { retry_offsets_hours: [24, 72], on_exhausted: "downgrade" } },
    max_attempts: 4,
    downgrade_plan: "basic",
    ...overrides,
  })) as { id: string };
}

beforeEach(() => {
  const db = freshDb();
  mock = new CountingStripeAdapter();
  setStripeAdapter(mock);
  ctx = systemContext(db);
  ctx.stripe = mock;
});
afterEach(() => {
  setStripeAdapter(null);
  closeDatabase();
});

describe("dunning short-circuits (no charge may fire)", () => {
  it("records a canceled run on an already-paid invoice without charging Stripe or bumping attempts", async () => {
    const { invoice } = await seedPastDue("pro");
    await call(ctx, "mark_invoice_paid", { id: invoice.id });

    mock.scriptCharge(invoice.id, [
      { paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" },
    ]);
    const policy = await createPolicy();
    const run = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;

    expect(run.outcome).toBe("canceled");
    expect(run.decline_code).toBeNull();
    expect(run.scheduled_at).toBeNull();
    expect(run.attempt).toBe(0);
    expect(mock.retryCalls).toBe(0);

    const after = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(after.status).toBe("paid");
    expect(after.attempt_count).toBe(0);
  });

  it("records an abandoned run on a voided invoice without charging Stripe or bumping attempts", async () => {
    const { invoice } = await seedPastDue("pro");
    await call(ctx, "void_invoice", { id: invoice.id });

    mock.scriptCharge(invoice.id, [{ paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" }]);
    const policy = await createPolicy();
    const run = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;

    expect(run.outcome).toBe("abandoned");
    expect(mock.retryCalls).toBe(0);
    const after = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(after.status).toBe("void");
    expect(after.attempt_count).toBe(0);
  });
});

describe("dunning input guards", () => {
  it("rejects a policy that belongs to a different entity than the invoice", async () => {
    const { invoice } = await seedPastDue("pro");
    const foreignPolicy = (await call(ctx, "create_dunning_policy", {
      entity_id: TEST_ENTITY_B,
      name: "foreign",
    })) as { id: string };

    await expect(call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: foreignPolicy.id })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(mock.retryCalls).toBe(0);
  });

  it("fails with INVOICE_NOT_FOUND for a missing invoice and DUNNING_POLICY_NOT_FOUND for a missing policy", async () => {
    const { invoice } = await seedPastDue("pro");
    const policy = await createPolicy();
    await expect(call(ctx, "run_dunning", { invoice_id: "no-such-invoice", policy_id: policy.id })).rejects.toMatchObject({
      code: "INVOICE_NOT_FOUND",
    });
    await expect(call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: "no-such-policy" })).rejects.toMatchObject({
      code: "DUNNING_POLICY_NOT_FOUND",
    });
    expect(mock.retryCalls).toBe(0);
  });

  it("fails get/list of a missing run with DUNNING_RUN_NOT_FOUND", async () => {
    await expect(call(ctx, "get_dunning_run", { id: "no-such-run" })).rejects.toMatchObject({
      code: "DUNNING_RUN_NOT_FOUND",
    });
  });
});

describe("retry-boundary arithmetic (max_attempts vs schedule length)", () => {
  it("caps retries at max_attempts even when the schedule is longer", async () => {
    const { invoice } = await seedPastDue("pro");
    const policy = await createPolicy({
      rules: { card_declined: { retry_offsets_hours: [24, 72, 120], on_exhausted: "downgrade" } },
      max_attempts: 2,
    });
    mock.scriptCharge(invoice.id, [
      { paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" },
      { paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" },
    ]);

    const run1 = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run1.outcome).toBe("retry_failed");
    expect(run1.attempt).toBe(1);

    // attempt == max_attempts is terminal: only ONE retry happened with max_attempts=2.
    const run2 = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run2.outcome).toBe("downgraded");
    expect(run2.attempt).toBe(2);
    expect(mock.retryCalls).toBe(2);
  });

  it("indexes the retry offset by attempt: attempt N schedules offsets[N-1]", async () => {
    const { invoice } = await seedPastDue("pro");
    const policy = await createPolicy({
      rules: { card_declined: { retry_offsets_hours: [24, 72], on_exhausted: "downgrade" } },
      max_attempts: 4,
    });
    mock.scriptCharge(invoice.id, [
      { paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" },
      { paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" },
      { paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" },
    ]);

    const run1 = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run1.outcome).toBe("retry_failed");
    expect(Math.abs(Date.parse(run1.scheduled_at!) - (Date.now() + 24 * 3600 * 1000))).toBeLessThan(5000);

    const run2 = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run2.outcome).toBe("retry_failed");
    expect(Math.abs(Date.parse(run2.scheduled_at!) - (Date.now() + 72 * 3600 * 1000))).toBeLessThan(5000);

    // attempt 3 > offsets.length (2) → terminal, never a third retry.
    const run3 = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run3.outcome).toBe("downgraded");
    expect(mock.retryCalls).toBe(3);
  });
});

describe("terminal actions on retry exhaustion", () => {
  it("cancels the subscription on on_exhausted=cancel and leaves the invoice open", async () => {
    const { invoice, sub } = await seedPastDue("pro");
    const policy = await createPolicy({
      rules: { card_declined: { retry_offsets_hours: [], on_exhausted: "cancel" } },
      max_attempts: 1,
    });
    mock.scriptCharge(invoice.id, [{ paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" }]);

    const run = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run.outcome).toBe("canceled");
    const subAfter = (await call(ctx, "get_subscription", { id: sub.id })) as SubscriptionRow;
    expect(subAfter.status).toBe("canceled");
    const invAfter = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(invAfter.status).toBe("open"); // cancel does NOT mark the invoice uncollectible
  });

  it("leaves every state untouched on on_exhausted=none (invoice stays open, sub stays active)", async () => {
    const { invoice, sub } = await seedPastDue("pro");
    const policy = await createPolicy({
      rules: { card_declined: { retry_offsets_hours: [], on_exhausted: "none" } },
      max_attempts: 1,
    });
    mock.scriptCharge(invoice.id, [{ paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" }]);

    const run = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run.outcome).toBe("abandoned");
    const invAfter = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(invAfter.status).toBe("open");
    const subAfter = (await call(ctx, "get_subscription", { id: sub.id })) as SubscriptionRow;
    expect(subAfter.status).toBe("active");
    expect(subAfter.plan).toBe("pro");
  });

  it("does not downgrade when on_exhausted=downgrade but no downgrade_plan is configured — invoice stays open", async () => {
    const { invoice, sub } = await seedPastDue("pro");
    const policy = await createPolicy({
      rules: { card_declined: { retry_offsets_hours: [], on_exhausted: "downgrade" } },
      max_attempts: 1,
      downgrade_plan: undefined,
    });
    mock.scriptCharge(invoice.id, [{ paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" }]);

    const run = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run.outcome).toBe("abandoned");
    const subAfter = (await call(ctx, "get_subscription", { id: sub.id })) as SubscriptionRow;
    expect(subAfter.plan).toBe("pro");
    const invAfter = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(invAfter.status).toBe("open");
  });

  it("tolerates on_exhausted=cancel when the invoice has no subscription (abandoned, no crash)", async () => {
    const { invoice } = await seedPastDue("pro", { subscription: false });
    const policy = await createPolicy({
      rules: { card_declined: { retry_offsets_hours: [], on_exhausted: "cancel" } },
      max_attempts: 1,
    });
    mock.scriptCharge(invoice.id, [{ paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" }]);

    const run = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run.outcome).toBe("abandoned");
    const invAfter = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(invAfter.status).toBe("open");
  });
});

describe("decline-code resolution precedence", () => {
  it("prefers the charge's decline_code over the caller-supplied one", async () => {
    const { invoice } = await seedPastDue("pro");
    const policy = await createPolicy({
      rules: { expired_card: { retry_offsets_hours: [24], on_exhausted: "cancel" } },
      max_attempts: 2,
    });
    mock.scriptCharge(invoice.id, [{ paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "expired_card" }]);

    const run = (await call(ctx, "run_dunning", {
      invoice_id: invoice.id,
      policy_id: policy.id,
      decline_code: "generic_decline",
    })) as DunningRunRow;
    expect(run.decline_code).toBe("expired_card");
  });

  it("falls back to the caller-supplied decline_code when the charge reports none", async () => {
    const { invoice } = await seedPastDue("pro");
    const policy = await createPolicy({
      rules: { stolen_card: { retry_offsets_hours: [24], on_exhausted: "cancel" } },
      max_attempts: 2,
    });
    mock.scriptCharge(invoice.id, [{ paid: false, invoice_id: invoice.id, amount: 4000, decline_code: null }]);

    const run = (await call(ctx, "run_dunning", {
      invoice_id: invoice.id,
      policy_id: policy.id,
      decline_code: "stolen_card",
    })) as DunningRunRow;
    expect(run.decline_code).toBe("stolen_card");
  });

  it("defaults to generic_decline when neither the charge nor the caller names one", async () => {
    const { invoice } = await seedPastDue("pro");
    const policy = await createPolicy({ max_attempts: 2 });
    mock.scriptCharge(invoice.id, [{ paid: false, invoice_id: invoice.id, amount: 4000, decline_code: null }]);

    const run = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run.decline_code).toBe("generic_decline");
  });
});

describe("ruleForDeclineCode fallback", () => {
  it("uses the hardcoded [24,72]/mark_uncollectible fallback when neither the code nor default is configured", () => {
    const rule = ruleForDeclineCode({}, "expired_card");
    expect(rule.retry_offsets_hours).toEqual([24, 72]);
    expect(rule.on_exhausted).toBe("mark_uncollectible");
  });

  it("prefers the code-specific rule over the default rule", () => {
    const schedule = {
      default: { retry_offsets_hours: [24], on_exhausted: "mark_uncollectible" as const },
      expired_card: { retry_offsets_hours: [24, 72, 120], on_exhausted: "cancel" as const },
    };
    expect(ruleForDeclineCode(schedule, "expired_card").on_exhausted).toBe("cancel");
    expect(ruleForDeclineCode(schedule, "lost_card").on_exhausted).toBe("mark_uncollectible");
  });

  it("treats a null decline code as the default rule", () => {
    const schedule = { default: { retry_offsets_hours: [1], on_exhausted: "none" as const } };
    expect(ruleForDeclineCode(schedule, null).on_exhausted).toBe("none");
  });
});
