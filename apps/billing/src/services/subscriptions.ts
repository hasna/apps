import { z } from "zod";
import type { Database } from "bun:sqlite";
import { SUBSCRIPTION_STATUSES, type SubscriptionRow } from "../types/index.js";
import { InvalidTransitionError, SubscriptionNotFoundError } from "../types/index.js";
import { appendAudit } from "../db/audit.js";
import { getCustomerRow } from "./customers.js";
import { CustomerNotFoundError } from "../types/index.js";
import { scopeToEntities } from "./authorization.js";
import {
  assertEntity,
  entityIdSchema,
  newId,
  nowIso,
  type ServiceContext,
  type ServiceOp,
} from "./context.js";

export function getSubscriptionRow(db: Database, id: string): SubscriptionRow | null {
  return (db.query("SELECT * FROM subscriptions WHERE id = ?").get(id) as SubscriptionRow | null) ?? null;
}

function requireSubscription(ctx: ServiceContext, id: string): SubscriptionRow {
  const row = getSubscriptionRow(ctx.db, id);
  if (!row) throw new SubscriptionNotFoundError(`Subscription ${id} not found.`);
  return row;
}

const createInput = z.object({
  customer_id: z.string().min(1),
  plan: z.string().min(1),
});
const getInput = z.object({ id: z.string().min(1) });
const listInput = z.object({
  entity_id: entityIdSchema.optional(),
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
});
const cancelInput = z.object({ id: z.string().min(1), at_period_end: z.boolean().optional() });
const changePlanInput = z.object({ id: z.string().min(1), plan: z.string().min(1) });

export const subscriptionOps: ServiceOp[] = [
  {
    op: "create_subscription",
    resource: "subscriptions",
    summary: "Start a subscription for a customer (mirrors Stripe subscription state).",
    action: "write",
    scopes: ["billing:write"],
    mutates: true,
    method: "POST",
    path: "/v1/subscriptions",
    input: createInput,
    profiles: ["minimal", "standard", "full"],
    handler: async (ctx, raw) => {
      const input = raw as z.infer<typeof createInput>;
      const customer = getCustomerRow(ctx.db, input.customer_id);
      if (!customer) throw new CustomerNotFoundError(`Customer ${input.customer_id} not found.`);
      assertEntity(ctx, "write", customer.entity_id, "subscriptions");
      const stripeSub = await ctx.stripe.createSubscription({
        customer: customer.stripe_customer_id ?? customer.id,
        plan: input.plan,
      });
      const id = newId();
      const at = nowIso();
      ctx.db.run(
        `INSERT INTO subscriptions (id, entity_id, customer_id, stripe_subscription_id, plan, status, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 0, ?, ?)`,
        [
          id,
          customer.entity_id,
          customer.id,
          stripeSub.id,
          input.plan,
          stripeSub.current_period_start,
          stripeSub.current_period_end,
          at,
          at,
        ],
      );
      appendAudit(ctx.db, {
        entity_id: customer.entity_id,
        actor_id: ctx.actor_id,
        action: "create_subscription",
        resource: "subscriptions",
        resource_id: id,
        detail: `plan=${input.plan} stripe=${stripeSub.id}`,
      });
      return requireSubscription(ctx, id);
    },
  },
  {
    op: "get_subscription",
    resource: "subscriptions",
    summary: "Fetch a subscription by id (entity-authorized).",
    action: "read",
    scopes: ["billing:read"],
    mutates: false,
    method: "GET",
    path: "/v1/subscriptions/:id",
    input: getInput,
    profiles: ["minimal", "standard", "full"],
    handler: (ctx, raw) => {
      const { id } = raw as z.infer<typeof getInput>;
      const row = requireSubscription(ctx, id);
      assertEntity(ctx, "read", row.entity_id, "subscriptions");
      return row;
    },
  },
  {
    op: "list_subscriptions",
    resource: "subscriptions",
    summary: "List subscriptions the caller may read.",
    action: "read",
    scopes: ["billing:read"],
    mutates: false,
    method: "GET",
    path: "/v1/subscriptions",
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
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = ctx.db.query(`SELECT * FROM subscriptions ${where} ORDER BY created_at`).all(...params) as SubscriptionRow[];
      return scopeToEntities(rows, ctx.principal);
    },
  },
  {
    op: "cancel_subscription",
    resource: "subscriptions",
    summary: "Cancel a subscription immediately or at period end.",
    action: "write",
    scopes: ["billing:write"],
    mutates: true,
    method: "POST",
    path: "/v1/subscriptions/:id/cancel",
    input: cancelInput,
    profiles: ["standard", "full"],
    handler: async (ctx, raw) => {
      const input = raw as z.infer<typeof cancelInput>;
      const row = requireSubscription(ctx, input.id);
      assertEntity(ctx, "write", row.entity_id, "subscriptions");
      if (row.status === "canceled") throw new InvalidTransitionError("Subscription is already canceled.");
      if (input.at_period_end) {
        ctx.db.run("UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = ? WHERE id = ?", [nowIso(), input.id]);
      } else {
        if (row.stripe_subscription_id) await ctx.stripe.cancelSubscription(row.stripe_subscription_id);
        ctx.db.run("UPDATE subscriptions SET status = 'canceled', cancel_at_period_end = 0, updated_at = ? WHERE id = ?", [nowIso(), input.id]);
      }
      appendAudit(ctx.db, {
        entity_id: row.entity_id,
        actor_id: ctx.actor_id,
        action: "cancel_subscription",
        resource: "subscriptions",
        resource_id: input.id,
        detail: input.at_period_end ? "at_period_end" : "immediate",
      });
      return requireSubscription(ctx, input.id);
    },
  },
  {
    op: "change_subscription_plan",
    resource: "subscriptions",
    summary: "Move a subscription to a different plan (graduated up/downgrade).",
    action: "write",
    scopes: ["billing:write"],
    mutates: true,
    method: "POST",
    path: "/v1/subscriptions/:id/plan",
    input: changePlanInput,
    profiles: ["standard", "full"],
    handler: async (ctx, raw) => {
      const input = raw as z.infer<typeof changePlanInput>;
      const row = requireSubscription(ctx, input.id);
      assertEntity(ctx, "write", row.entity_id, "subscriptions");
      if (row.status === "canceled") throw new InvalidTransitionError("Cannot change plan on a canceled subscription.");
      if (row.stripe_subscription_id) await ctx.stripe.updateSubscriptionPlan(row.stripe_subscription_id, input.plan);
      ctx.db.run("UPDATE subscriptions SET plan = ?, updated_at = ? WHERE id = ?", [input.plan, nowIso(), input.id]);
      appendAudit(ctx.db, {
        entity_id: row.entity_id,
        actor_id: ctx.actor_id,
        action: "change_subscription_plan",
        resource: "subscriptions",
        resource_id: input.id,
        detail: `${row.plan}->${input.plan}`,
      });
      return requireSubscription(ctx, input.id);
    },
  },
];
