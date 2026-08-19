// Agent-authored (SOL consult refused: "Selected model is at capacity" on two
// distinct healthy Codewith accounts — no SOL opinion was produced for this repo).
//
// Event-ingest edges the golden flows in billing-domain.test.ts do not reach:
// the stripe_invoice_id update path, no-customer / no-invoice payloads, unknown
// event types, the invoice.voided and credit_note.created queueing (queued but
// NOT applied locally), equal-timestamp ordering, and the fallback signing
// secret env name. A regression here means forged/partial webhook payloads
// mutate money state, or real Stripe events fail to mirror paid invoices.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { freshDb, systemContext, TEST_ENTITY_A } from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import { getOp } from "../src/services/registry.js";
import { runOp, type ServiceContext } from "../src/services/context.js";
import { insertInvoice } from "../src/services/invoices.js";
import { MockStripeAdapter, setStripeAdapter } from "../src/adapters/stripe.js";
import { eventSignedPayload } from "../src/services/events.js";
import type { AccountingReconciliationRow, CustomerRow, EventRow, InvoiceRow } from "../src/types/index.js";

async function call(ctx: ServiceContext, opName: string, input: unknown): Promise<unknown> {
  const op = getOp(opName);
  if (!op) throw new Error(`no op ${opName}`);
  return runOp(op, ctx, input);
}

const WEBHOOK_SECRET = "whsec_test_events_edge";
const FALLBACK_SECRET = "whsec_test_events_edge_fallback";

let ctx: ServiceContext;
let mock: MockStripeAdapter;

function signEvent(input: { stripe_event_id: string; type: string; payload?: Record<string, unknown> }, secret = WEBHOOK_SECRET): string {
  return mock.signWebhook(eventSignedPayload(input), secret);
}

async function seedCustomerAndInvoice(): Promise<{ customer: CustomerRow; invoice: InvoiceRow }> {
  const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "a@b.com" })) as CustomerRow;
  // create_invoice's public input schema does not carry stripe_invoice_id on
  // origin/main (the field lands via the unmerged billing source edits); seed
  // it through the exported insertInvoice so the webhook join-back under test
  // (applyEventEffect's `WHERE stripe_invoice_id = ? OR id = ?`) is exercised.
  const invoice = insertInvoice(ctx.db, TEST_ENTITY_A, customer.id, {
    amount_due: 2500,
    stripe_invoice_id: "in_stripe_1",
  });
  return { customer, invoice };
}

beforeEach(() => {
  const db = freshDb();
  mock = new MockStripeAdapter();
  setStripeAdapter(mock);
  ctx = systemContext(db);
  ctx.stripe = mock;
  process.env["HASNA_BILLING_STRIPE_WEBHOOK_SECRET"] = WEBHOOK_SECRET;
  delete process.env["BILLING_STRIPE_WEBHOOK_SECRET"];
});
afterEach(() => {
  setStripeAdapter(null);
  delete process.env["HASNA_BILLING_STRIPE_WEBHOOK_SECRET"];
  delete process.env["BILLING_STRIPE_WEBHOOK_SECRET"];
  closeDatabase();
});

describe("invoice.paid effect paths", () => {
  it("marks the local invoice paid by its stripe_invoice_id (the id Stripe actually knows)", async () => {
    const { customer, invoice } = await seedCustomerAndInvoice();
    const body = {
      stripe_event_id: "evt_paid_by_stripe_id",
      type: "invoice.paid",
      payload: { customer: customer.stripe_customer_id, invoice: "in_stripe_1", amount_paid: 2500, currency: "usd", created: 100 },
    };
    await call(ctx, "ingest_event", { entity_id: TEST_ENTITY_A, ...body, signature: signEvent(body) });
    const after = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(after.status).toBe("paid");
    expect(after.amount_paid).toBe(2500);
  });

  it("falls back to amount_due when the payload amount is zero (NULLIF(0,0) semantics)", async () => {
    const { customer, invoice } = await seedCustomerAndInvoice();
    const body = {
      stripe_event_id: "evt_paid_zero_amount",
      type: "invoice.paid",
      payload: { customer: customer.stripe_customer_id, invoice: "in_stripe_1", amount_paid: 0, currency: "usd", created: 100 },
    };
    await call(ctx, "ingest_event", { entity_id: TEST_ENTITY_A, ...body, signature: signEvent(body) });
    const after = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(after.status).toBe("paid");
    expect(after.amount_paid).toBe(2500);
  });

  it("clears delinquency and queues reconciliation even when no invoice id is present (source_id unknown)", async () => {
    const { customer } = await seedCustomerAndInvoice();
    await call(ctx, "update_customer", { id: customer.id, delinquent: true });
    const body = {
      stripe_event_id: "evt_paid_no_invoice",
      type: "invoice.paid",
      payload: { customer: customer.stripe_customer_id, created: 100 },
    };
    await call(ctx, "ingest_event", { entity_id: TEST_ENTITY_A, ...body, signature: signEvent(body) });
    const after = (await call(ctx, "get_customer", { id: customer.id })) as CustomerRow;
    expect(after.delinquent).toBe(0);
    const recon = (await call(ctx, "list_accounting_reconciliation", { entity_id: TEST_ENTITY_A })) as AccountingReconciliationRow[];
    expect(recon).toHaveLength(1);
    expect(recon[0]).toMatchObject({ event_type: "invoice.paid", source_id: "unknown", state: "pending" });
  });
});

describe("payloads that must have NO local money effect", () => {
  it("stores a payment_failed event with no customer as processed without touching anything", async () => {
    const body = {
      stripe_event_id: "evt_failed_no_customer",
      type: "invoice.payment_failed",
      payload: { invoice: "in_x", amount: 100, created: 100 },
    };
    const evt = (await call(ctx, "ingest_event", { entity_id: TEST_ENTITY_A, ...body, signature: signEvent(body) })) as EventRow;
    expect(evt.status).toBe("processed");
    const recon = (await call(ctx, "list_accounting_reconciliation", { entity_id: TEST_ENTITY_A })) as AccountingReconciliationRow[];
    expect(recon).toHaveLength(0);
    const customers = (await call(ctx, "list_customers", { entity_id: TEST_ENTITY_A })) as CustomerRow[];
    expect(customers.every((c) => c.delinquent === 0)).toBe(true);
  });

  it("stores an unknown event type as processed with no local effect and no reconciliation row", async () => {
    const body = {
      stripe_event_id: "evt_unknown",
      type: "charge.succeeded",
      payload: { id: "ch_1", amount: 500, created: 100 },
    };
    const evt = (await call(ctx, "ingest_event", { entity_id: TEST_ENTITY_A, ...body, signature: signEvent(body) })) as EventRow;
    expect(evt.status).toBe("processed");
    const recon = (await call(ctx, "list_accounting_reconciliation", { entity_id: TEST_ENTITY_A })) as AccountingReconciliationRow[];
    expect(recon).toHaveLength(0);
  });

  it("queues reconciliation for invoice.voided but does NOT void the local invoice", async () => {
    const { customer, invoice } = await seedCustomerAndInvoice();
    const body = {
      stripe_event_id: "evt_voided",
      type: "invoice.voided",
      payload: { customer: customer.stripe_customer_id, invoice: "in_stripe_1", amount: 2500, currency: "usd", created: 100 },
    };
    await call(ctx, "ingest_event", { entity_id: TEST_ENTITY_A, ...body, signature: signEvent(body) });
    const after = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(after.status).toBe("open"); // voiding is a local operator action, not an event effect
    const recon = (await call(ctx, "list_accounting_reconciliation", { entity_id: TEST_ENTITY_A })) as AccountingReconciliationRow[];
    expect(recon.map((r) => r.event_type)).toEqual(["invoice.voided"]);
  });

  it("queues reconciliation for credit_note.created", async () => {
    const { customer } = await seedCustomerAndInvoice();
    const body = {
      stripe_event_id: "evt_credit_note",
      type: "credit_note.created",
      payload: { id: "cn_1", customer: customer.stripe_customer_id, amount: 100, currency: "usd", created: 100 },
    };
    await call(ctx, "ingest_event", { entity_id: TEST_ENTITY_A, ...body, signature: signEvent(body) });
    const recon = (await call(ctx, "list_accounting_reconciliation", { entity_id: TEST_ENTITY_A })) as AccountingReconciliationRow[];
    expect(recon.map((r) => r.event_type)).toEqual(["credit_note.created"]);
    expect(recon[0]).toMatchObject({ source_id: "cn_1", amount: 100, currency: "usd" });
  });
});

describe("ordering and idempotency edges", () => {
  it("does not suppress an event whose created timestamp equals a prior one (strictly newer required)", async () => {
    const { customer } = await seedCustomerAndInvoice();
    const first = {
      stripe_event_id: "evt_equal_1",
      type: "invoice.paid",
      payload: { customer: customer.stripe_customer_id, invoice: "in_stripe_1", created: 100 },
    };
    await call(ctx, "ingest_event", { entity_id: TEST_ENTITY_A, ...first, signature: signEvent(first) });
    const second = {
      stripe_event_id: "evt_equal_2",
      type: "invoice.paid",
      payload: { customer: customer.stripe_customer_id, invoice: "in_stripe_1", created: 100 },
    };
    const evt = (await call(ctx, "ingest_event", { entity_id: TEST_ENTITY_A, ...second, signature: signEvent(second) })) as EventRow;
    expect(evt.status).toBe("processed");
    const events = (await call(ctx, "list_events", { entity_id: TEST_ENTITY_A })) as EventRow[];
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.status === "processed")).toBe(true);
  });

  it("dedupes on stripe_event_id across different payloads (first write wins)", async () => {
    const { customer } = await seedCustomerAndInvoice();
    const body = { stripe_event_id: "evt_same", type: "invoice.paid", payload: { customer: customer.stripe_customer_id, created: 100 } };
    await call(ctx, "ingest_event", { entity_id: TEST_ENTITY_A, ...body, signature: signEvent(body) });
    const replay = (await call(ctx, "ingest_event", {
      entity_id: TEST_ENTITY_A,
      ...body,
      signature: signEvent(body),
    })) as EventRow & { idempotent_replay?: boolean };
    expect(replay.idempotent_replay).toBe(true);
    const events = (await call(ctx, "list_events", { entity_id: TEST_ENTITY_A })) as EventRow[];
    expect(events).toHaveLength(1);
  });
});

describe("signing secret resolution and reads", () => {
  it("accepts the BILLING_STRIPE_WEBHOOK_SECRET fallback env name", async () => {
    delete process.env["HASNA_BILLING_STRIPE_WEBHOOK_SECRET"];
    process.env["BILLING_STRIPE_WEBHOOK_SECRET"] = FALLBACK_SECRET;
    const { customer } = await seedCustomerAndInvoice();
    const body = {
      stripe_event_id: "evt_fallback_secret",
      type: "invoice.payment_failed",
      payload: { customer: customer.stripe_customer_id, created: 100 },
    };
    const evt = (await call(ctx, "ingest_event", {
      entity_id: TEST_ENTITY_A,
      ...body,
      signature: signEvent(body, FALLBACK_SECRET),
    })) as EventRow;
    expect(evt.status).toBe("processed");
  });

  it("fails with EVENT_NOT_FOUND for a missing event read", async () => {
    await expect(call(ctx, "get_event", { id: "nope" })).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
  });
});
