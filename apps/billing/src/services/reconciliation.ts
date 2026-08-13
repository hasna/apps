import { z } from "zod";
import type { Database } from "bun:sqlite";
import type { AccountingReconciliationRow, ReconciliationState } from "../types/index.js";
import { ReconciliationNotFoundError } from "../types/index.js";
import { appendAudit } from "../db/audit.js";
import { scopeToEntities } from "./authorization.js";
import {
  assertEntity,
  entityIdSchema,
  newId,
  nowIso,
  type ServiceOp,
} from "./context.js";

export interface ReconciliationInput {
  entity_id: string;
  source: "stripe" | "billing";
  source_id: string;
  event_type: string;
  accounting_entry_ref?: string | null;
  amount?: number | null;
  currency?: string | null;
  state?: ReconciliationState;
  payload?: Record<string, unknown>;
}

export function emitAccountingReconciliation(
  db: Database,
  actorId: string,
  input: ReconciliationInput,
): AccountingReconciliationRow {
  const id = newId();
  const at = nowIso();
  const state = input.state ?? "pending";
  const payload = JSON.stringify(input.payload ?? {});
  db.run(
    `INSERT INTO accounting_reconciliation_events
      (id, entity_id, source, source_id, event_type, accounting_entry_ref, amount, currency, state, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, source_id, event_type) DO UPDATE SET
      accounting_entry_ref = COALESCE(excluded.accounting_entry_ref, accounting_reconciliation_events.accounting_entry_ref),
      state = excluded.state,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at`,
    [
      id,
      input.entity_id,
      input.source,
      input.source_id,
      input.event_type,
      input.accounting_entry_ref ?? null,
      input.amount ?? null,
      input.currency ?? null,
      state,
      payload,
      at,
      at,
    ],
  );
  const row = db
    .query("SELECT * FROM accounting_reconciliation_events WHERE source = ? AND source_id = ? AND event_type = ?")
    .get(input.source, input.source_id, input.event_type) as AccountingReconciliationRow;
  appendAudit(db, {
    entity_id: input.entity_id,
    actor_id: actorId,
    action: "accounting_reconciliation",
    resource: "accounting_reconciliation_events",
    resource_id: row.id,
    detail: `${input.source}:${input.event_type}:${state}`,
  });
  return row;
}

const listInput = z.object({
  entity_id: entityIdSchema.optional(),
  state: z.enum(["pending", "written", "failed"]).optional(),
  source: z.enum(["stripe", "billing"]).optional(),
});
const getInput = z.object({ id: z.string().min(1) });
const markWrittenInput = z.object({
  id: z.string().min(1),
  accounting_entry_ref: z.string().min(1),
});

export const reconciliationOps: ServiceOp[] = [
  {
    op: "list_accounting_reconciliation",
    resource: "accounting_reconciliation_events",
    summary: "List billing-to-accounting reconciliation events for support and accounting writeback.",
    action: "read",
    scopes: ["billing:read"],
    mutates: false,
    method: "GET",
    path: "/v1/accounting-reconciliation",
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
      if (input.state) {
        clauses.push("state = ?");
        params.push(input.state);
      }
      if (input.source) {
        clauses.push("source = ?");
        params.push(input.source);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = ctx.db
        .query(`SELECT * FROM accounting_reconciliation_events ${where} ORDER BY created_at`)
        .all(...params) as AccountingReconciliationRow[];
      return scopeToEntities(rows, ctx.principal);
    },
  },
  {
    op: "get_accounting_reconciliation",
    resource: "accounting_reconciliation_events",
    summary: "Fetch one billing-to-accounting reconciliation event.",
    action: "read",
    scopes: ["billing:read"],
    mutates: false,
    method: "GET",
    path: "/v1/accounting-reconciliation/:id",
    input: getInput,
    profiles: ["standard", "full"],
    handler: (ctx, raw) => {
      const { id } = raw as z.infer<typeof getInput>;
      const row = ctx.db
        .query("SELECT * FROM accounting_reconciliation_events WHERE id = ?")
        .get(id) as AccountingReconciliationRow | null;
      if (!row) throw new ReconciliationNotFoundError(`Reconciliation event ${id} not found.`);
      assertEntity(ctx, "read", row.entity_id, "accounting_reconciliation_events");
      return row;
    },
  },
  {
    op: "mark_accounting_reconciliation_written",
    resource: "accounting_reconciliation_events",
    summary: "Mark a reconciliation event written to accounting with the immutable accounting entry ref.",
    action: "write",
    scopes: ["billing:write"],
    mutates: true,
    method: "POST",
    path: "/v1/accounting-reconciliation/:id/written",
    input: markWrittenInput,
    profiles: ["standard", "full"],
    handler: (ctx, raw) => {
      const input = raw as z.infer<typeof markWrittenInput>;
      const row = ctx.db
        .query("SELECT * FROM accounting_reconciliation_events WHERE id = ?")
        .get(input.id) as AccountingReconciliationRow | null;
      if (!row) throw new ReconciliationNotFoundError(`Reconciliation event ${input.id} not found.`);
      assertEntity(ctx, "write", row.entity_id, "accounting_reconciliation_events");
      ctx.db.run("UPDATE accounting_reconciliation_events SET state = 'written', accounting_entry_ref = ?, updated_at = ? WHERE id = ?", [
        input.accounting_entry_ref,
        nowIso(),
        input.id,
      ]);
      appendAudit(ctx.db, {
        entity_id: row.entity_id,
        actor_id: ctx.actor_id,
        action: "mark_accounting_reconciliation_written",
        resource: "accounting_reconciliation_events",
        resource_id: input.id,
        detail: input.accounting_entry_ref,
      });
      return ctx.db.query("SELECT * FROM accounting_reconciliation_events WHERE id = ?").get(input.id);
    },
  },
];
