import { z } from "zod";
import type { Database } from "bun:sqlite";
import type { CustomerRow } from "../types/index.js";
import { CustomerNotFoundError } from "../types/index.js";
import { appendAudit } from "../db/audit.js";
import { scopeToEntities } from "./authorization.js";
import {
  assertEntity,
  entityIdSchema,
  newId,
  nowIso,
  type ServiceContext,
  type ServiceOp,
} from "./context.js";

export function getCustomerRow(db: Database, id: string): CustomerRow | null {
  return (db.query("SELECT * FROM customers WHERE id = ?").get(id) as CustomerRow | null) ?? null;
}

function requireCustomer(ctx: ServiceContext, id: string): CustomerRow {
  const row = getCustomerRow(ctx.db, id);
  if (!row) throw new CustomerNotFoundError(`Customer ${id} not found.`);
  return row;
}

const createInput = z.object({
  entity_id: entityIdSchema,
  entity_slug: z.string().min(1).optional(),
  email: z.string().email(),
  name: z.string().min(1).optional(),
  currency: z.string().length(3).optional(),
});

const getInput = z.object({ id: z.string().min(1) });
const listInput = z.object({ entity_id: entityIdSchema.optional(), status: z.string().optional() });
const updateInput = z.object({
  id: z.string().min(1),
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
  delinquent: z.boolean().optional(),
});

export const customerOps: ServiceOp[] = [
  {
    op: "create_customer",
    resource: "customers",
    summary: "Create a billing customer anchored to a seller entity (mirrors a Stripe customer ref).",
    action: "write",
    scopes: ["billing:write"],
    mutates: true,
    method: "POST",
    path: "/v1/customers",
    input: createInput,
    profiles: ["minimal", "standard", "full"],
    handler: async (ctx, raw) => {
      const input = raw as z.infer<typeof createInput>;
      assertEntity(ctx, "write", input.entity_id, "customers");
      const stripeCustomer = await ctx.stripe.createCustomer({
        email: input.email,
        name: input.name ?? null,
        currency: input.currency ?? "usd",
      });
      const id = newId();
      const at = nowIso();
      ctx.db.run(
        `INSERT INTO customers (id, entity_id, entity_slug, stripe_customer_id, email, name, currency, delinquent, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          id,
          input.entity_id,
          input.entity_slug ?? null,
          stripeCustomer.id,
          input.email,
          input.name ?? null,
          input.currency ?? "usd",
          at,
          at,
        ],
      );
      appendAudit(ctx.db, {
        entity_id: input.entity_id,
        actor_id: ctx.actor_id,
        action: "create_customer",
        resource: "customers",
        resource_id: id,
        detail: `stripe=${stripeCustomer.id}`,
      });
      return requireCustomer(ctx, id);
    },
  },
  {
    op: "get_customer",
    resource: "customers",
    summary: "Fetch a customer by id (entity-authorized).",
    action: "read",
    scopes: ["billing:read"],
    mutates: false,
    method: "GET",
    path: "/v1/customers/:id",
    input: getInput,
    profiles: ["minimal", "standard", "full"],
    handler: (ctx, raw) => {
      const { id } = raw as z.infer<typeof getInput>;
      const row = requireCustomer(ctx, id);
      assertEntity(ctx, "read", row.entity_id, "customers");
      return row;
    },
  },
  {
    op: "list_customers",
    resource: "customers",
    summary: "List customers the caller may read (deny-by-default entity scoping).",
    action: "read",
    scopes: ["billing:read"],
    mutates: false,
    method: "GET",
    path: "/v1/customers",
    input: listInput,
    profiles: ["minimal", "standard", "full"],
    handler: (ctx, raw) => {
      const input = raw as z.infer<typeof listInput>;
      const rows = input.entity_id
        ? (ctx.db.query("SELECT * FROM customers WHERE entity_id = ? ORDER BY created_at").all(input.entity_id) as CustomerRow[])
        : (ctx.db.query("SELECT * FROM customers ORDER BY created_at").all() as CustomerRow[]);
      return scopeToEntities(rows, ctx.principal);
    },
  },
  {
    op: "update_customer",
    resource: "customers",
    summary: "Update customer contact/delinquency fields.",
    action: "write",
    scopes: ["billing:write"],
    mutates: true,
    method: "PATCH",
    path: "/v1/customers/:id",
    input: updateInput,
    profiles: ["standard", "full"],
    handler: (ctx, raw) => {
      const input = raw as z.infer<typeof updateInput>;
      const row = requireCustomer(ctx, input.id);
      assertEntity(ctx, "write", row.entity_id, "customers");
      ctx.db.run(
        `UPDATE customers SET email = ?, name = ?, delinquent = ?, updated_at = ? WHERE id = ?`,
        [
          input.email ?? row.email,
          input.name ?? row.name,
          input.delinquent === undefined ? row.delinquent : input.delinquent ? 1 : 0,
          nowIso(),
          input.id,
        ],
      );
      appendAudit(ctx.db, {
        entity_id: row.entity_id,
        actor_id: ctx.actor_id,
        action: "update_customer",
        resource: "customers",
        resource_id: input.id,
      });
      return requireCustomer(ctx, input.id);
    },
  },
];
