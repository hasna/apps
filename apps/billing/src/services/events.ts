import { z } from "zod";
import type { Database } from "bun:sqlite";
import type { EventRow } from "../types/index.js";
import { EventNotFoundError, WebhookVerificationError } from "../types/index.js";
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
import { emitAccountingReconciliation } from "./reconciliation.js";

export function getEventRow(db: Database, id: string): EventRow | null {
  return (db.query("SELECT * FROM events WHERE id = ?").get(id) as EventRow | null) ?? null;
}

const ingestInput = z.object({
  entity_id: entityIdSchema,
  stripe_event_id: z.string().min(1),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  signature: z
    .string()
    .min(1)
    .describe(
      "Stripe-Signature header value (t=<unix>,v1=<hmac-sha256>). Verified fail-closed against " +
        "HASNA_BILLING_STRIPE_WEBHOOK_SECRET BEFORE any state mutation (BUILD-SPEC webhook integrity). On the " +
        "serve tier it may instead arrive as the Stripe-Signature request header.",
    ),
});
const getInput = z.object({ id: z.string().min(1) });
const listInput = z.object({ entity_id: entityIdSchema.optional(), type: z.string().optional() });

/** Resolve the Stripe webhook signing secret (presence enforced fail-closed). */
function webhookSecret(): string {
  return process.env["HASNA_BILLING_STRIPE_WEBHOOK_SECRET"] || process.env["BILLING_STRIPE_WEBHOOK_SECRET"] || "";
}

/**
 * Canonical raw payload the Stripe signature is computed over. Covers the
 * money-relevant, otherwise caller-controlled fields (event id, type, payload)
 * so a forged `invoice.paid`/`invoice.payment_failed` cannot pass verification.
 * Signer (mock/tests) and verifier MUST use this identical serialization.
 */
export function eventSignedPayload(input: {
  stripe_event_id: string;
  type: string;
  payload?: Record<string, unknown>;
}): string {
  return JSON.stringify({ id: input.stripe_event_id, type: input.type, data: input.payload ?? {} });
}

/** Apply a known Stripe event type to local mirror state. */
function applyEventEffect(ctx: ServiceContext, entityId: string, type: string, payload: Record<string, unknown>): string {
  const stripeCustomerId = typeof payload["customer"] === "string" ? (payload["customer"] as string) : null;
  const stripeInvoiceId = typeof payload["invoice"] === "string" ? (payload["invoice"] as string) : null;
  const amount = typeof payload["amount"] === "number" ? payload["amount"] : typeof payload["amount_paid"] === "number" ? payload["amount_paid"] : null;
  const currency = typeof payload["currency"] === "string" ? payload["currency"] : null;
  const providerObjectId = stripeInvoiceId ?? (typeof payload["id"] === "string" ? (payload["id"] as string) : null);
  if (type === "invoice.payment_failed" && stripeCustomerId) {
    ctx.db.run("UPDATE customers SET delinquent = 1, updated_at = ? WHERE entity_id = ? AND stripe_customer_id = ?", [nowIso(), entityId, stripeCustomerId]);
    emitAccountingReconciliation(ctx.db, ctx.actor_id, {
      entity_id: entityId,
      source: "stripe",
      source_id: providerObjectId ?? "unknown",
      event_type: "invoice.payment_failed",
      amount,
      currency,
      payload,
    });
    return "marked customer delinquent";
  }
  if (type === "invoice.paid" && stripeCustomerId) {
    ctx.db.run("UPDATE customers SET delinquent = 0, updated_at = ? WHERE entity_id = ? AND stripe_customer_id = ?", [nowIso(), entityId, stripeCustomerId]);
    if (stripeInvoiceId) {
      ctx.db.run(
        `UPDATE invoices
         SET status = 'paid', amount_paid = COALESCE(NULLIF(?, 0), amount_due), updated_at = ?
         WHERE entity_id = ? AND (stripe_invoice_id = ? OR id = ?)`,
        [amount ?? 0, nowIso(), entityId, stripeInvoiceId, stripeInvoiceId],
      );
    }
    emitAccountingReconciliation(ctx.db, ctx.actor_id, {
      entity_id: entityId,
      source: "stripe",
      source_id: providerObjectId ?? "unknown",
      event_type: "invoice.paid",
      amount,
      currency,
      payload,
    });
    return "cleared customer delinquency";
  }
  if (["invoice.voided", "charge.refunded", "charge.dispute.created", "credit_note.created"].includes(type)) {
    emitAccountingReconciliation(ctx.db, ctx.actor_id, {
      entity_id: entityId,
      source: "stripe",
      source_id: providerObjectId ?? type,
      event_type: type,
      amount,
      currency,
      payload,
    });
    return "queued accounting reconciliation";
  }
  return "no local effect";
}

function eventCreatedSeconds(payload: Record<string, unknown>): number | null {
  const created = payload["created"];
  return typeof created === "number" && Number.isSafeInteger(created) ? created : null;
}

function providerObjectId(type: string, payload: Record<string, unknown>): string | null {
  if (typeof payload["invoice"] === "string") return payload["invoice"] as string;
  if (typeof payload["id"] === "string") return payload["id"] as string;
  if (typeof payload["charge"] === "string") return payload["charge"] as string;
  return type.startsWith("invoice.") ? null : null;
}

function hasNewerProcessedEvent(ctx: ServiceContext, entityId: string, type: string, payload: Record<string, unknown>): boolean {
  const created = eventCreatedSeconds(payload);
  const objectId = providerObjectId(type, payload);
  if (created === null || objectId === null) return false;
  const rows = ctx.db.query("SELECT payload_json FROM events WHERE entity_id = ? AND type = ?").all(entityId, type) as Array<{ payload_json: string }>;
  for (const row of rows) {
    try {
      const prior = JSON.parse(row.payload_json) as Record<string, unknown>;
      if (providerObjectId(type, prior) === objectId) {
        const priorCreated = eventCreatedSeconds(prior);
        if (priorCreated !== null && priorCreated > created) return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export const eventOps: ServiceOp[] = [
  {
    op: "ingest_event",
    resource: "events",
    summary: "Idempotently ingest a Stripe webhook event (dedup on stripe_event_id) and apply its local effect.",
    action: "write",
    scopes: ["billing:write"],
    mutates: true,
    method: "POST",
    path: "/v1/events",
    input: ingestInput,
    profiles: ["standard", "full"],
    handler: (ctx, raw) => {
      const input = raw as z.infer<typeof ingestInput>;
      assertEntity(ctx, "write", input.entity_id, "events");

      // Webhook integrity (fail-closed): stripe_event_id/type/payload are
      // caller-controlled and applyEventEffect mutates money/delinquency state
      // on them, so an unsigned/forged event MUST be rejected here — before any
      // mutation and before the idempotency probe. A verified Stripe signature
      // (timing-safe HMAC-SHA256 + replay window) is required. Refuse outright
      // if no signing secret is configured rather than accepting unverifiable
      // events (BUILD-SPEC §5.1a webhook integrity).
      const secret = webhookSecret();
      if (!secret) {
        throw new WebhookVerificationError(
          "Stripe webhook signing secret is not configured (set HASNA_BILLING_STRIPE_WEBHOOK_SECRET); " +
            "refusing to ingest unverifiable events.",
        );
      }
      const verification = ctx.stripe.verifyWebhook(eventSignedPayload(input), input.signature, secret);
      if (!verification.ok) {
        throw new WebhookVerificationError(
          `Stripe signature verification failed: ${verification.reason ?? "invalid signature"}.`,
        );
      }

      // Idempotency: if we've already seen this Stripe event id, return it as-is.
      const existing = ctx.db.query("SELECT * FROM events WHERE stripe_event_id = ?").get(input.stripe_event_id) as EventRow | null;
      if (existing) return { ...existing, idempotent_replay: true };

      const id = newId();
      const at = nowIso();
      const payload = input.payload ?? {};
      if (hasNewerProcessedEvent(ctx, input.entity_id, input.type, payload)) {
        ctx.db.run(
          `INSERT INTO events (id, entity_id, stripe_event_id, type, status, payload_json, received_at, processed_at)
           VALUES (?, ?, ?, ?, 'ignored', ?, ?, ?)`,
          [id, input.entity_id, input.stripe_event_id, input.type, JSON.stringify(payload), at, at],
        );
        appendAudit(ctx.db, {
          entity_id: input.entity_id,
          actor_id: ctx.actor_id,
          action: "ignore_out_of_order_event",
          resource: "events",
          resource_id: id,
          detail: input.type,
        });
        return ctx.db.query("SELECT * FROM events WHERE id = ?").get(id) as EventRow;
      }
      const detail = applyEventEffect(ctx, input.entity_id, input.type, payload);
      ctx.db.run(
        `INSERT INTO events (id, entity_id, stripe_event_id, type, status, payload_json, received_at, processed_at)
         VALUES (?, ?, ?, ?, 'processed', ?, ?, ?)`,
        [id, input.entity_id, input.stripe_event_id, input.type, JSON.stringify(payload), at, at],
      );
      appendAudit(ctx.db, {
        entity_id: input.entity_id,
        actor_id: ctx.actor_id,
        action: "ingest_event",
        resource: "events",
        resource_id: id,
        detail: `${input.type}: ${detail}`,
      });
      return ctx.db.query("SELECT * FROM events WHERE id = ?").get(id) as EventRow;
    },
  },
  {
    op: "get_event",
    resource: "events",
    summary: "Fetch an ingested event by id.",
    action: "read",
    scopes: ["billing:read"],
    mutates: false,
    method: "GET",
    path: "/v1/events/:id",
    input: getInput,
    profiles: ["standard", "full"],
    handler: (ctx, raw) => {
      const { id } = raw as z.infer<typeof getInput>;
      const row = getEventRow(ctx.db, id);
      if (!row) throw new EventNotFoundError(`Event ${id} not found.`);
      assertEntity(ctx, "read", row.entity_id, "events");
      return row;
    },
  },
  {
    op: "list_events",
    resource: "events",
    summary: "List ingested events the caller may read.",
    action: "read",
    scopes: ["billing:read"],
    mutates: false,
    method: "GET",
    path: "/v1/events",
    input: listInput,
    profiles: ["standard", "full"],
    handler: (ctx, raw) => {
      const input = raw as z.infer<typeof listInput>;
      const clauses: string[] = [];
      const params: string[] = [];
      if (input.entity_id) {
        clauses.push("entity_id = ?");
        params.push(input.entity_id);
      }
      if (input.type) {
        clauses.push("type = ?");
        params.push(input.type);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = ctx.db.query(`SELECT * FROM events ${where} ORDER BY received_at`).all(...params) as EventRow[];
      return scopeToEntities(rows, ctx.principal);
    },
  },
];
