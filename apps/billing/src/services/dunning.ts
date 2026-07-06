import { z } from "zod";
import type { Database } from "bun:sqlite";
import {
  DECLINE_CODES,
  type DunningPolicyRow,
  type DunningRunOutcome,
  type DunningRunRow,
  type RetryRule,
  type RetrySchedule,
} from "../types/index.js";
import {
  DunningPolicyNotFoundError,
  DunningRunNotFoundError,
  InvoiceNotFoundError,
  ValidationError,
} from "../types/index.js";
import { appendAudit } from "../db/audit.js";
import { getInvoiceRow } from "./invoices.js";
import { getSubscriptionRow } from "./subscriptions.js";
import { scopeToEntities } from "./authorization.js";
import {
  assertEntity,
  entityIdSchema,
  newId,
  nowIso,
  type ServiceContext,
  type ServiceOp,
} from "./context.js";

export function getPolicyRow(db: Database, id: string): DunningPolicyRow | null {
  return (db.query("SELECT * FROM dunning_policies WHERE id = ?").get(id) as DunningPolicyRow | null) ?? null;
}

function requirePolicy(ctx: ServiceContext, id: string): DunningPolicyRow {
  const row = getPolicyRow(ctx.db, id);
  if (!row) throw new DunningPolicyNotFoundError(`Dunning policy ${id} not found.`);
  return row;
}

/** Resolve the retry rule for a decline code, falling back to `default`. */
export function ruleForDeclineCode(schedule: RetrySchedule, declineCode: string | null): RetryRule {
  const byCode = declineCode ? schedule[declineCode as keyof RetrySchedule] : undefined;
  return (
    byCode ??
    schedule.default ?? {
      retry_offsets_hours: [24, 72],
      on_exhausted: "mark_uncollectible",
    }
  );
}

const retryRuleSchema = z.object({
  retry_offsets_hours: z.array(z.number().int().nonnegative()),
  on_exhausted: z.enum(["cancel", "downgrade", "mark_uncollectible", "none"]),
});
const scheduleSchema = z.record(z.string(), retryRuleSchema);

const createPolicyInput = z.object({
  entity_id: entityIdSchema,
  name: z.string().min(1),
  rules: scheduleSchema.optional(),
  pre_dunning_hours: z.number().int().nonnegative().optional(),
  max_attempts: z.number().int().positive().optional(),
  downgrade_plan: z.string().min(1).optional(),
});
const getPolicyInput = z.object({ id: z.string().min(1) });
const listPolicyInput = z.object({ entity_id: entityIdSchema.optional() });

const runInput = z.object({
  invoice_id: z.string().min(1),
  policy_id: z.string().min(1),
  decline_code: z.enum(DECLINE_CODES).optional(),
});
const getRunInput = z.object({ id: z.string().min(1) });
const listRunInput = z.object({ entity_id: entityIdSchema.optional(), invoice_id: z.string().optional() });

function recordRun(
  ctx: ServiceContext,
  fields: {
    entity_id: string;
    invoice_id: string;
    policy_id: string;
    attempt: number;
    decline_code: string | null;
    outcome: DunningRunOutcome;
    scheduled_at: string | null;
    detail: string;
  },
): DunningRunRow {
  const id = newId();
  const at = nowIso();
  ctx.db.run(
    `INSERT INTO dunning_runs (id, entity_id, invoice_id, policy_id, attempt, decline_code, outcome, scheduled_at, executed_at, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      fields.entity_id,
      fields.invoice_id,
      fields.policy_id,
      fields.attempt,
      fields.decline_code,
      fields.outcome,
      fields.scheduled_at,
      at,
      fields.detail,
      at,
    ],
  );
  appendAudit(ctx.db, {
    entity_id: fields.entity_id,
    actor_id: ctx.actor_id,
    action: "dunning_run",
    resource: "dunning_runs",
    resource_id: id,
    detail: `outcome=${fields.outcome} attempt=${fields.attempt}`,
  });
  return ctx.db.query("SELECT * FROM dunning_runs WHERE id = ?").get(id) as DunningRunRow;
}

export const dunningOps: ServiceOp[] = [
  {
    op: "create_dunning_policy",
    resource: "dunning_policies",
    summary: "Create a dunning policy: decline-code retry schedule, pre-dunning window, graduated downgrade.",
    action: "write",
    scopes: ["billing:write"],
    mutates: true,
    method: "POST",
    path: "/v1/dunning-policies",
    input: createPolicyInput,
    profiles: ["standard", "full"],
    handler: (ctx, raw) => {
      const input = raw as z.infer<typeof createPolicyInput>;
      assertEntity(ctx, "write", input.entity_id, "dunning_policies");
      const id = newId();
      const at = nowIso();
      ctx.db.run(
        `INSERT INTO dunning_policies (id, entity_id, name, rules_json, pre_dunning_hours, max_attempts, downgrade_plan, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          id,
          input.entity_id,
          input.name,
          JSON.stringify(input.rules ?? {}),
          input.pre_dunning_hours ?? 72,
          input.max_attempts ?? 4,
          input.downgrade_plan ?? null,
          at,
          at,
        ],
      );
      appendAudit(ctx.db, {
        entity_id: input.entity_id,
        actor_id: ctx.actor_id,
        action: "create_dunning_policy",
        resource: "dunning_policies",
        resource_id: id,
      });
      return requirePolicy(ctx, id);
    },
  },
  {
    op: "get_dunning_policy",
    resource: "dunning_policies",
    summary: "Fetch a dunning policy by id.",
    action: "read",
    scopes: ["billing:read"],
    mutates: false,
    method: "GET",
    path: "/v1/dunning-policies/:id",
    input: getPolicyInput,
    profiles: ["standard", "full"],
    handler: (ctx, raw) => {
      const { id } = raw as z.infer<typeof getPolicyInput>;
      const row = requirePolicy(ctx, id);
      assertEntity(ctx, "read", row.entity_id, "dunning_policies");
      return row;
    },
  },
  {
    op: "list_dunning_policies",
    resource: "dunning_policies",
    summary: "List dunning policies the caller may read.",
    action: "read",
    scopes: ["billing:read"],
    mutates: false,
    method: "GET",
    path: "/v1/dunning-policies",
    input: listPolicyInput,
    profiles: ["standard", "full"],
    handler: (ctx, raw) => {
      const input = raw as z.infer<typeof listPolicyInput>;
      const rows = input.entity_id
        ? (ctx.db.query("SELECT * FROM dunning_policies WHERE entity_id = ? ORDER BY created_at").all(input.entity_id) as DunningPolicyRow[])
        : (ctx.db.query("SELECT * FROM dunning_policies ORDER BY created_at").all() as DunningPolicyRow[]);
      return scopeToEntities(rows, ctx.principal);
    },
  },
  {
    op: "run_dunning",
    resource: "dunning_runs",
    summary: "Execute one dunning attempt on a past-due invoice: smart retry, then graduated downgrade/cancel on exhaustion.",
    action: "run",
    scopes: ["dunning:run"],
    mutates: true,
    method: "POST",
    path: "/v1/dunning-runs",
    input: runInput,
    profiles: ["minimal", "standard", "full"],
    handler: async (ctx, raw) => {
      const input = raw as z.infer<typeof runInput>;
      const invoice = getInvoiceRow(ctx.db, input.invoice_id);
      if (!invoice) throw new InvoiceNotFoundError(`Invoice ${input.invoice_id} not found.`);
      const policy = requirePolicy(ctx, input.policy_id);
      assertEntity(ctx, "run", invoice.entity_id, "dunning_runs");
      if (policy.entity_id !== invoice.entity_id) {
        throw new ValidationError("Policy and invoice belong to different entities.");
      }

      const attempt = invoice.attempt_count + 1;
      if (invoice.status === "paid") {
        return recordRun(ctx, {
          entity_id: invoice.entity_id,
          invoice_id: invoice.id,
          policy_id: policy.id,
          attempt: invoice.attempt_count,
          decline_code: null,
          outcome: "canceled",
          scheduled_at: null,
          detail: "invoice already paid; nothing to dun",
        });
      }
      if (invoice.status === "void") {
        return recordRun(ctx, {
          entity_id: invoice.entity_id,
          invoice_id: invoice.id,
          policy_id: policy.id,
          attempt: invoice.attempt_count,
          decline_code: null,
          outcome: "abandoned",
          scheduled_at: null,
          detail: "invoice is void; abandoned",
        });
      }

      const schedule = JSON.parse(policy.rules_json || "{}") as RetrySchedule;
      const charge = await ctx.stripe.retryInvoicePayment({ invoice_id: invoice.stripe_invoice_id ?? invoice.id, amount: invoice.amount_due });
      ctx.db.run("UPDATE invoices SET attempt_count = ?, updated_at = ? WHERE id = ?", [attempt, nowIso(), invoice.id]);

      if (charge.paid) {
        ctx.db.run("UPDATE invoices SET status = 'paid', amount_paid = ?, updated_at = ? WHERE id = ?", [invoice.amount_due, nowIso(), invoice.id]);
        return recordRun(ctx, {
          entity_id: invoice.entity_id,
          invoice_id: invoice.id,
          policy_id: policy.id,
          attempt,
          decline_code: null,
          outcome: "retry_succeeded",
          scheduled_at: null,
          detail: "collection succeeded on retry",
        });
      }

      const declineCode = charge.decline_code ?? input.decline_code ?? "generic_decline";
      const rule = ruleForDeclineCode(schedule, declineCode);
      const hasMoreRetries = attempt < policy.max_attempts && attempt <= rule.retry_offsets_hours.length;

      if (hasMoreRetries) {
        const offsetHours = rule.retry_offsets_hours[attempt - 1] ?? rule.retry_offsets_hours[rule.retry_offsets_hours.length - 1] ?? 24;
        const scheduledAt = new Date(Date.now() + offsetHours * 3600 * 1000).toISOString();
        return recordRun(ctx, {
          entity_id: invoice.entity_id,
          invoice_id: invoice.id,
          policy_id: policy.id,
          attempt,
          decline_code: declineCode,
          outcome: "retry_failed",
          scheduled_at: scheduledAt,
          detail: `decline=${declineCode}; next retry in ${offsetHours}h`,
        });
      }

      // Retries exhausted → terminal action per the rule.
      return applyTerminalAction(ctx, invoice.id, policy, invoice.entity_id, attempt, declineCode, rule);
    },
  },
  {
    op: "get_dunning_run",
    resource: "dunning_runs",
    summary: "Fetch a dunning run by id.",
    action: "read",
    scopes: ["billing:read"],
    mutates: false,
    method: "GET",
    path: "/v1/dunning-runs/:id",
    input: getRunInput,
    profiles: ["standard", "full"],
    handler: (ctx, raw) => {
      const { id } = raw as z.infer<typeof getRunInput>;
      const row = (ctx.db.query("SELECT * FROM dunning_runs WHERE id = ?").get(id) as DunningRunRow | null) ?? null;
      if (!row) throw new DunningRunNotFoundError(`Dunning run ${id} not found.`);
      assertEntity(ctx, "read", row.entity_id, "dunning_runs");
      return row;
    },
  },
  {
    op: "list_dunning_runs",
    resource: "dunning_runs",
    summary: "List dunning runs the caller may read (filter by entity/invoice).",
    action: "read",
    scopes: ["billing:read"],
    mutates: false,
    method: "GET",
    path: "/v1/dunning-runs",
    input: listRunInput,
    profiles: ["standard", "full"],
    handler: (ctx, raw) => {
      const input = raw as z.infer<typeof listRunInput>;
      const clauses: string[] = [];
      const params: string[] = [];
      if (input.entity_id) {
        clauses.push("entity_id = ?");
        params.push(input.entity_id);
      }
      if (input.invoice_id) {
        clauses.push("invoice_id = ?");
        params.push(input.invoice_id);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = ctx.db.query(`SELECT * FROM dunning_runs ${where} ORDER BY created_at`).all(...params) as DunningRunRow[];
      return scopeToEntities(rows, ctx.principal);
    },
  },
];

function applyTerminalAction(
  ctx: ServiceContext,
  invoiceId: string,
  policy: DunningPolicyRow,
  entityId: string,
  attempt: number,
  declineCode: string,
  rule: RetryRule,
): DunningRunRow {
  const invoice = getInvoiceRow(ctx.db, invoiceId);
  if (rule.on_exhausted === "downgrade" && policy.downgrade_plan && invoice?.subscription_id) {
    const sub = getSubscriptionRow(ctx.db, invoice.subscription_id);
    if (sub) {
      ctx.db.run("UPDATE subscriptions SET plan = ?, status = 'past_due', updated_at = ? WHERE id = ?", [policy.downgrade_plan, nowIso(), sub.id]);
    }
    return recordRun(ctx, {
      entity_id: entityId,
      invoice_id: invoiceId,
      policy_id: policy.id,
      attempt,
      decline_code: declineCode,
      outcome: "downgraded",
      scheduled_at: null,
      detail: `retries exhausted; graduated downgrade to ${policy.downgrade_plan}`,
    });
  }

  if (rule.on_exhausted === "cancel" && invoice?.subscription_id) {
    ctx.db.run("UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE id = ?", [nowIso(), invoice.subscription_id]);
    return recordRun(ctx, {
      entity_id: entityId,
      invoice_id: invoiceId,
      policy_id: policy.id,
      attempt,
      decline_code: declineCode,
      outcome: "canceled",
      scheduled_at: null,
      detail: "retries exhausted; subscription canceled",
    });
  }

  if (rule.on_exhausted === "mark_uncollectible") {
    ctx.db.run("UPDATE invoices SET status = 'uncollectible', updated_at = ? WHERE id = ?", [nowIso(), invoiceId]);
  }
  return recordRun(ctx, {
    entity_id: entityId,
    invoice_id: invoiceId,
    policy_id: policy.id,
    attempt,
    decline_code: declineCode,
    outcome: "abandoned",
    scheduled_at: null,
    detail: `retries exhausted; on_exhausted=${rule.on_exhausted}`,
  });
}
