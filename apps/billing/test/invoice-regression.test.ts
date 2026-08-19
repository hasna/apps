// Sol-guided coverage (tests-coverage-sol workflow, 2026-08-19).
//
// Priority 1 measured red regression: marking an already-paid invoice paid a
// second time with a different amount must NOT silently overwrite the
// recorded amount_paid. An open invoice paid for 2500 and then re-marked with
// 9999 currently overwrites amount_paid to 9999 with no error — a silent
// mutation of a money record. The corrected contract: paying an already-paid
// invoice is an invalid transition (rejection), mirroring the existing
// "Cannot pay a voided invoice" guard.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { freshDb, systemContext, TEST_ENTITY_A } from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import { getOp } from "../src/services/registry.js";
import { runOp, type ServiceContext } from "../src/services/context.js";
import { MockStripeAdapter, setStripeAdapter } from "../src/adapters/stripe.js";
import type { InvoiceRow } from "../src/types/index.js";

async function call(ctx: ServiceContext, opName: string, input: unknown): Promise<unknown> {
  const op = getOp(opName);
  if (!op) throw new Error(`no op ${opName}`);
  return runOp(op, ctx, input);
}

let ctx: ServiceContext;
let mock: MockStripeAdapter;

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

describe("double-pay guard (money-record integrity)", () => {
  it("rejects re-marking an already-paid invoice instead of overwriting amount_paid", async () => {
    const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "a@b.com" })) as { id: string };
    const invoice = (await call(ctx, "create_invoice", { customer_id: customer.id, amount_due: 2500 })) as InvoiceRow;

    // Positive first payment.
    const paid = (await call(ctx, "mark_invoice_paid", { id: invoice.id, amount_paid: 2500 })) as InvoiceRow;
    expect(paid.status).toBe("paid");
    expect(paid.amount_paid).toBe(2500);

    // REGRESSION: a second payment call with a different amount must be
    // rejected — never a silent overwrite of the recorded collection.
    await expect(call(ctx, "mark_invoice_paid", { id: invoice.id, amount_paid: 9999 })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });

    // The recorded money figure is untouched.
    const after = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(after.status).toBe("paid");
    expect(after.amount_paid).toBe(2500);
  });

  it("rejects re-marking with the same amount too (paid is terminal for the pay verb)", async () => {
    const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "a@b.com" })) as { id: string };
    const invoice = (await call(ctx, "create_invoice", { customer_id: customer.id, amount_due: 1500 })) as InvoiceRow;
    await call(ctx, "mark_invoice_paid", { id: invoice.id, amount_paid: 1500 });
    await expect(call(ctx, "mark_invoice_paid", { id: invoice.id, amount_paid: 1500 })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    const after = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(after.amount_paid).toBe(1500);
  });

  it("still allows voiding an OPEN invoice (amount untouched, no money collected)", async () => {
    const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "a@b.com" })) as { id: string };
    const invoice = (await call(ctx, "create_invoice", { customer_id: customer.id, amount_due: 800 })) as InvoiceRow;
    const voided = (await call(ctx, "void_invoice", { id: invoice.id })) as InvoiceRow;
    expect(voided.status).toBe("void");
    expect(voided.amount_paid).toBe(0);
    // A voided invoice stays unpayable.
    await expect(call(ctx, "mark_invoice_paid", { id: invoice.id })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });
});
