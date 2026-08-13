import { z } from "zod";
import type { Database } from "bun:sqlite";
import { INVOICE_STATUSES, type InvoiceRow } from "../types/index.js";
import { CustomerNotFoundError, InvalidTransitionError, InvoiceNotFoundError } from "../types/index.js";
import { appendAudit } from "../db/audit.js";
import { getCustomerRow } from "./customers.js";
import { scopeToEntities } from "./authorization.js";
import {
  assertEntity,
  entityIdSchema,
  newId,
  nowIso,
  type ServiceContext,
  type ServiceOp,
} from "./context.js";

export function getInvoiceRow(db: Database, id: string): InvoiceRow | null {
  return (db.query("SELECT * FROM invoices WHERE id = ?").get(id) as InvoiceRow | null) ?? null;
}

function requireInvoice(ctx: ServiceContext, id: string): InvoiceRow {
  const row = getInvoiceRow(ctx.db, id);
  if (!row) throw new InvoiceNotFoundError(`Invoice ${id} not found.`);
  return row;
}

const createInput = z.object({
  customer_id: z.string().min(1),
  subscription_id: z.string().min(1).optional(),
  amount_due: z.number().int().nonnegative(),
  currency: z.string().length(3).optional(),
  due_date: z.string().optional(),
});
const getInput = z.object({ id: z.string().min(1) });
const listInput = z.object({
  entity_id: entityIdSchema.optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  customer_id: z.string().optional(),
});
const markPaidInput = z.object({ id: z.string().min(1), amount_paid: z.number().int().nonnegative().optional() });
const voidInput = z.object({ id: z.string().min(1) });

/** Insert an invoice row (also used by event ingest). */
export function insertInvoice(
  db: Database,
  entityId: string,
  customerId: string,
  input: { subscription_id?: string | null; amount_due: number; currency?: string; due_date?: string | null; stripe_invoice_id?: string | null; status?: string },
): InvoiceRow {
  const id = newId();
  const at = nowIso();
  db.run(
    `INSERT INTO invoices (id, entity_id, customer_id, subscription_id, stripe_invoice_id, amount_due, amount_paid, currency, status, attempt_count, due_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?)`,
    [
      id,
      entityId,
      customerId,
      input.subscription_id ?? null,
      input.stripe_invoice_id ?? null,
      input.amount_due,
      input.currency ?? "usd",
      input.status ?? "open",
      input.due_date ?? null,
      at,
      at,
    ],
  );
  return db.query("SELECT * FROM invoices WHERE id = ?").get(id) as InvoiceRow;
}

export const invoiceOps: ServiceOp[] = [
  {
    op: "create_invoice",
    resource: "invoices",
    summary: "Create a multi-entity invoice for a customer (seller entity, amount, status).",
    action: "write",
    scopes: ["billing:write"],
    mutates: true,
    method: "POST",
    path: "/v1/invoices",
    input: createInput,
    profiles: ["minimal", "standard", "full"],
    handler: (ctx, raw) => {
      const input = raw as z.infer<typeof createInput>;
      const customer = getCustomerRow(ctx.db, input.customer_id);
      if (!customer) throw new CustomerNotFoundError(`Customer ${input.customer_id} not found.`);
      assertEntity(ctx, "write", customer.entity_id, "invoices");
      const row = insertInvoice(ctx.db, customer.entity_id, customer.id, {
        subscription_id: input.subscription_id ?? null,
        amount_due: input.amount_due,
        currency: input.currency ?? customer.currency,
        due_date: input.due_date ?? null,
        status: "open",
      });
      appendAudit(ctx.db, {
        entity_id: customer.entity_id,
        actor_id: ctx.actor_id,
        action: "create_invoice",
        resource: "invoices",
        resource_id: row.id,
        detail: `amount_due=${input.amount_due}`,
      });
      return row;
    },
  },
  {
    op: "get_invoice",
    resource: "invoices",
    summary: "Fetch an invoice by id (entity-authorized).",
    action: "read",
    scopes: ["billing:read"],
    mutates: false,
    method: "GET",
    path: "/v1/invoices/:id",
    input: getInput,
    profiles: ["minimal", "standard", "full"],
    handler: (ctx, raw) => {
      const { id } = raw as z.infer<typeof getInput>;
      const row = requireInvoice(ctx, id);
      assertEntity(ctx, "read", row.entity_id, "invoices");
      return row;
    },
  },
  {
    op: "list_invoices",
    resource: "invoices",
    summary: "List invoices the caller may read (filter by entity/status/customer).",
    action: "read",
    scopes: ["billing:read"],
    mutates: false,
    method: "GET",
    path: "/v1/invoices",
    input: listInput,
    profiles: ["minimal", "standard", "full"],
    handler: (ctx, raw) => {
      const input = raw as z.infer<typeof listInput>;
      const clauses: string[] = [];
      const params: string[] = [];
      if (input.entity_id) {
        clauses.push("entity_id = ?");
        params.push(input.entity_id);
      }
      if (input.status) {
        clauses.push("status = ?");
        params.push(input.status);
      }
      if (input.customer_id) {
        clauses.push("customer_id = ?");
        params.push(input.customer_id);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = ctx.db.query(`SELECT * FROM invoices ${where} ORDER BY created_at`).all(...params) as InvoiceRow[];
      return scopeToEntities(rows, ctx.principal);
    },
  },
  {
    op: "mark_invoice_paid",
    resource: "invoices",
    summary: "Mark an open invoice paid (reconciles a successful collection).",
    action: "write",
    scopes: ["billing:write"],
    mutates: true,
    method: "POST",
    path: "/v1/invoices/:id/pay",
    input: markPaidInput,
    profiles: ["standard", "full"],
    handler: (ctx, raw) => {
      const input = raw as z.infer<typeof markPaidInput>;
      const row = requireInvoice(ctx, input.id);
      assertEntity(ctx, "write", row.entity_id, "invoices");
      if (row.status === "void") throw new InvalidTransitionError("Cannot pay a voided invoice.");
      const paid = input.amount_paid ?? row.amount_due;
      ctx.db.run("UPDATE invoices SET status = 'paid', amount_paid = ?, updated_at = ? WHERE id = ?", [paid, nowIso(), input.id]);
      appendAudit(ctx.db, {
        entity_id: row.entity_id,
        actor_id: ctx.actor_id,
        action: "mark_invoice_paid",
        resource: "invoices",
        resource_id: input.id,
        detail: `amount_paid=${paid}`,
      });
      return requireInvoice(ctx, input.id);
    },
  },
  {
    op: "void_invoice",
    resource: "invoices",
    summary: "Void an invoice (terminal, non-collectible).",
    action: "write",
    scopes: ["billing:write"],
    mutates: true,
    method: "POST",
    path: "/v1/invoices/:id/void",
    input: voidInput,
    profiles: ["full"],
    handler: (ctx, raw) => {
      const input = raw as z.infer<typeof voidInput>;
      const row = requireInvoice(ctx, input.id);
      assertEntity(ctx, "write", row.entity_id, "invoices");
      if (row.status === "paid") throw new InvalidTransitionError("Cannot void a paid invoice.");
      ctx.db.run("UPDATE invoices SET status = 'void', updated_at = ? WHERE id = ?", [nowIso(), input.id]);
      appendAudit(ctx.db, {
        entity_id: row.entity_id,
        actor_id: ctx.actor_id,
        action: "void_invoice",
        resource: "invoices",
        resource_id: input.id,
      });
      return requireInvoice(ctx, input.id);
    },
  },
];
