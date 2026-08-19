// Agent-authored (SOL consult refused: "Selected model is at capacity" on two
// distinct healthy Codewith accounts — no SOL opinion was produced for this repo).
//
// Invoice state-machine edges: terminal-state guards (void/paid), partial and
// zero-amount payment semantics, input-boundary rejections, and not-found
// paths. A regression here means paid invoices can be voided (money reversal
// without audit trail) or voided invoices can be paid (double collection).

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

async function seedInvoice(amount = 2500): Promise<{ customer: { id: string }; invoice: InvoiceRow }> {
  const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "a@b.com" })) as { id: string };
  const invoice = (await call(ctx, "create_invoice", { customer_id: customer.id, amount_due: amount })) as InvoiceRow;
  return { customer, invoice };
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

describe("terminal-state guards", () => {
  it("rejects paying a voided invoice (would otherwise double-collect)", async () => {
    const { invoice } = await seedInvoice();
    await call(ctx, "void_invoice", { id: invoice.id });
    await expect(call(ctx, "mark_invoice_paid", { id: invoice.id })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    const after = (await call(ctx, "get_invoice", { id: invoice.id })) as InvoiceRow;
    expect(after.status).toBe("void");
    expect(after.amount_paid).toBe(0);
  });

  it("rejects voiding a paid invoice (money already collected)", async () => {
    const { invoice } = await seedInvoice();
    await call(ctx, "mark_invoice_paid", { id: invoice.id });
    await expect(call(ctx, "void_invoice", { id: invoice.id })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("allows voiding an uncollectible invoice (still not collectible)", async () => {
    const { invoice } = await seedInvoice();
    const db = (ctx as unknown as { db: import("bun:sqlite").Database }).db;
    db.run("UPDATE invoices SET status = 'uncollectible', updated_at = ? WHERE id = ?", [new Date().toISOString(), invoice.id]);
    const voided = (await call(ctx, "void_invoice", { id: invoice.id })) as InvoiceRow;
    expect(voided.status).toBe("void");
  });
});

describe("payment amount semantics", () => {
  it("records a partial payment as paid with the amount actually collected", async () => {
    const { invoice } = await seedInvoice(2500);
    const paid = (await call(ctx, "mark_invoice_paid", { id: invoice.id, amount_paid: 500 })) as InvoiceRow;
    expect(paid.status).toBe("paid");
    expect(paid.amount_paid).toBe(500);
  });

  it("honors an explicit zero amount_paid (does not fall back to amount_due)", async () => {
    const { invoice } = await seedInvoice(2500);
    const paid = (await call(ctx, "mark_invoice_paid", { id: invoice.id, amount_paid: 0 })) as InvoiceRow;
    expect(paid.status).toBe("paid");
    expect(paid.amount_paid).toBe(0);
  });

  it("defaults amount_paid to amount_due when omitted", async () => {
    const { invoice } = await seedInvoice(2500);
    const paid = (await call(ctx, "mark_invoice_paid", { id: invoice.id })) as InvoiceRow;
    expect(paid.amount_paid).toBe(2500);
  });
});

describe("create boundary guards", () => {
  it("rejects a negative amount_due at the input boundary", async () => {
    const { customer } = await seedInvoice();
    // runOp surfaces the zod rejection before any handler runs; the no-row side
    // effect is the load-bearing assertion.
    await expect(call(ctx, "create_invoice", { customer_id: customer.id, amount_due: -1 })).rejects.toThrow();
    const open = (await call(ctx, "list_invoices", { entity_id: TEST_ENTITY_A })) as InvoiceRow[];
    expect(open).toHaveLength(1); // only the seeded invoice exists; nothing negative was inserted
  });

  it("accepts a zero-amount invoice (credit/comp lines are legal)", async () => {
    const { customer } = await seedInvoice();
    const zero = (await call(ctx, "create_invoice", { customer_id: customer.id, amount_due: 0 })) as InvoiceRow;
    expect(zero.status).toBe("open");
    expect(zero.amount_due).toBe(0);
  });

  it("rejects an invalid currency at the input boundary", async () => {
    const { customer } = await seedInvoice();
    await expect(call(ctx, "create_invoice", { customer_id: customer.id, amount_due: 100, currency: "US" })).rejects.toThrow();
  });

  it("fails with CUSTOMER_NOT_FOUND for a missing customer", async () => {
    await expect(call(ctx, "create_invoice", { customer_id: "nope", amount_due: 100 })).rejects.toMatchObject({
      code: "CUSTOMER_NOT_FOUND",
    });
  });
});

describe("reads and filters", () => {
  it("fails with INVOICE_NOT_FOUND for a missing invoice", async () => {
    await expect(call(ctx, "get_invoice", { id: "nope" })).rejects.toMatchObject({ code: "INVOICE_NOT_FOUND" });
  });

  it("filters list_invoices by status", async () => {
    const { invoice } = await seedInvoice();
    await seedInvoice(3000);
    await call(ctx, "mark_invoice_paid", { id: invoice.id });
    const open = (await call(ctx, "list_invoices", { entity_id: TEST_ENTITY_A, status: "open" })) as InvoiceRow[];
    expect(open).toHaveLength(1);
    const paid = (await call(ctx, "list_invoices", { entity_id: TEST_ENTITY_A, status: "paid" })) as InvoiceRow[];
    expect(paid).toHaveLength(1);
    expect(paid[0]!.id).toBe(invoice.id);
  });
});
