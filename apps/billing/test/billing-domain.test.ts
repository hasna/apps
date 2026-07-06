import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { freshDb, systemContext, TEST_ENTITY_A } from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import { getOp } from "../src/services/registry.js";
import { runOp, type ServiceContext } from "../src/services/context.js";
import { MockStripeAdapter, setStripeAdapter } from "../src/adapters/stripe.js";
import { eventSignedPayload } from "../src/services/events.js";
import { ruleForDeclineCode } from "../src/services/dunning.js";
import type { CustomerRow, DunningRunRow, InvoiceRow, SubscriptionRow } from "../src/types/index.js";

async function call(ctx: ServiceContext, opName: string, input: unknown): Promise<unknown> {
  const op = getOp(opName);
  if (!op) throw new Error(`no op ${opName}`);
  return runOp(op, ctx, input);
}

let ctx: ServiceContext;
let mock: MockStripeAdapter;

const WEBHOOK_SECRET = "whsec_test_billing_signing_secret";

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

/** Sign an ingest input with the mock adapter → a valid Stripe-Signature header. */
function signEvent(input: { stripe_event_id: string; type: string; payload?: Record<string, unknown> }): string {
  return mock.signWebhook(eventSignedPayload(input), WEBHOOK_SECRET);
}

describe("customers", () => {
  it("creates a customer anchored to the seller entity with a stripe ref", async () => {
    const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "a@b.com", name: "Acme" })) as CustomerRow;
    expect(customer.entity_id).toBe(TEST_ENTITY_A);
    expect(customer.email).toBe("a@b.com");
    expect(customer.stripe_customer_id).toMatch(/^cus_mock_/);
  });
});

describe("subscriptions & invoices", () => {
  it("mirrors subscription state and creates a multi-entity invoice", async () => {
    const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "a@b.com" })) as CustomerRow;
    const sub = (await call(ctx, "create_subscription", { customer_id: customer.id, plan: "pro" })) as SubscriptionRow;
    expect(sub.status).toBe("active");
    expect(sub.plan).toBe("pro");
    expect(sub.entity_id).toBe(TEST_ENTITY_A);

    const invoice = (await call(ctx, "create_invoice", {
      customer_id: customer.id,
      subscription_id: sub.id,
      amount_due: 2500,
    })) as InvoiceRow;
    expect(invoice.status).toBe("open");
    expect(invoice.amount_due).toBe(2500);
    expect(invoice.entity_id).toBe(TEST_ENTITY_A);

    const paid = (await call(ctx, "mark_invoice_paid", { id: invoice.id })) as InvoiceRow;
    expect(paid.status).toBe("paid");
    expect(paid.amount_paid).toBe(2500);
  });
});

describe("dunning golden flows", () => {
  async function seedPastDue(plan: string) {
    const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "a@b.com" })) as CustomerRow;
    const sub = (await call(ctx, "create_subscription", { customer_id: customer.id, plan })) as SubscriptionRow;
    const invoice = (await call(ctx, "create_invoice", { customer_id: customer.id, subscription_id: sub.id, amount_due: 4000 })) as InvoiceRow;
    return { customer, sub, invoice };
  }

  it("retries on insufficient_funds then succeeds", async () => {
    const { invoice } = await seedPastDue("pro");
    const policy = (await call(ctx, "create_dunning_policy", {
      entity_id: TEST_ENTITY_A,
      name: "standard",
      rules: { insufficient_funds: { retry_offsets_hours: [24, 72, 120], on_exhausted: "downgrade" } },
      max_attempts: 4,
      downgrade_plan: "basic",
    })) as { id: string };

    // First attempt fails, second succeeds.
    mock.scriptCharge(invoice.id, [
      { paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "insufficient_funds" },
      { paid: true, invoice_id: invoice.id, amount: 4000, decline_code: null },
    ]);

    const run1 = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run1.outcome).toBe("retry_failed");
    expect(run1.decline_code).toBe("insufficient_funds");
    expect(run1.scheduled_at).not.toBeNull();

    const run2 = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run2.outcome).toBe("retry_succeeded");

    const invoiceAfter = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(invoiceAfter.status).toBe("paid");
  });

  it("graduated downgrade after retries are exhausted", async () => {
    const { invoice, sub } = await seedPastDue("pro");
    const policy = (await call(ctx, "create_dunning_policy", {
      entity_id: TEST_ENTITY_A,
      name: "aggressive",
      rules: { card_declined: { retry_offsets_hours: [1], on_exhausted: "downgrade" } },
      max_attempts: 2,
      downgrade_plan: "basic",
    })) as { id: string };

    mock.scriptCharge(invoice.id, [
      { paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" },
      { paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "card_declined" },
    ]);

    const first = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(first.outcome).toBe("retry_failed");
    const second = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(second.outcome).toBe("downgraded");

    const subAfter = (await call(ctx, "get_subscription", { id: sub.id })) as SubscriptionRow;
    expect(subAfter.plan).toBe("basic");
    expect(subAfter.status).toBe("past_due");
  });

  it("marks the invoice uncollectible when the default rule exhausts", async () => {
    const { invoice } = await seedPastDue("pro");
    const policy = (await call(ctx, "create_dunning_policy", {
      entity_id: TEST_ENTITY_A,
      name: "default-only",
      rules: { default: { retry_offsets_hours: [], on_exhausted: "mark_uncollectible" } },
      max_attempts: 1,
    })) as { id: string };
    mock.scriptCharge(invoice.id, [{ paid: false, invoice_id: invoice.id, amount: 4000, decline_code: "generic_decline" }]);
    const run = (await call(ctx, "run_dunning", { invoice_id: invoice.id, policy_id: policy.id })) as DunningRunRow;
    expect(run.outcome).toBe("abandoned");
    const inv = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(inv.status).toBe("uncollectible");
  });

  it("resolves the decline-code rule with a default fallback", () => {
    const schedule = { insufficient_funds: { retry_offsets_hours: [24], on_exhausted: "cancel" as const } };
    expect(ruleForDeclineCode(schedule, "insufficient_funds").on_exhausted).toBe("cancel");
    expect(ruleForDeclineCode(schedule, "expired_card").on_exhausted).toBe("mark_uncollectible");
  });
});

describe("events (idempotent ingest)", () => {
  it("dedupes on stripe_event_id and applies the local effect", async () => {
    const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "a@b.com" })) as CustomerRow;
    const body1 = { stripe_event_id: "evt_1", type: "invoice.payment_failed", payload: { customer: customer.stripe_customer_id } };
    const evt1 = (await call(ctx, "ingest_event", {
      entity_id: TEST_ENTITY_A,
      ...body1,
      signature: signEvent(body1),
    })) as { id: string; status: string };
    expect(evt1.status).toBe("processed");

    const cust = (await call(ctx, "get_customer", { id: customer.id })) as CustomerRow;
    expect(cust.delinquent).toBe(1);

    const body2 = { stripe_event_id: "evt_1", type: "invoice.payment_failed", payload: {} };
    const replay = (await call(ctx, "ingest_event", {
      entity_id: TEST_ENTITY_A,
      ...body2,
      signature: signEvent(body2),
    })) as { id: string; idempotent_replay?: boolean };
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.id).toBe(evt1.id);
  });

  it("rejects a forged event (bad signature) fail-closed WITHOUT mutating state", async () => {
    const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "a@b.com" })) as CustomerRow;
    await expect(
      call(ctx, "ingest_event", {
        entity_id: TEST_ENTITY_A,
        stripe_event_id: "evt_forged",
        type: "invoice.paid",
        payload: { customer: customer.stripe_customer_id },
        signature: "t=9999999999,v1=deadbeef",
      }),
    ).rejects.toMatchObject({ code: "WEBHOOK_VERIFICATION_FAILED" });

    // No event row was written and delinquency was untouched.
    const events = (await call(ctx, "list_events", { entity_id: TEST_ENTITY_A })) as unknown[];
    expect(events.length).toBe(0);
  });

  it("refuses to ingest when no signing secret is configured (fail-closed)", async () => {
    delete process.env["HASNA_BILLING_STRIPE_WEBHOOK_SECRET"];
    const body = { stripe_event_id: "evt_nosecret", type: "invoice.paid", payload: {} };
    await expect(
      call(ctx, "ingest_event", { entity_id: TEST_ENTITY_A, ...body, signature: "t=1,v1=abc" }),
    ).rejects.toMatchObject({ code: "WEBHOOK_VERIFICATION_FAILED" });
  });
});
