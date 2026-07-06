import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { AuditRow } from "../types/index.js";

/**
 * Append-only, tamper-evident audit log (BUILD-SPEC §4.7). Billing records
 * money/lifecycle events (invoice payment, subscription cancel, dunning
 * downgrade, storage push/pull). Rows are:
 *   - insert-only (SQLite triggers RAISE(ABORT) on UPDATE/DELETE, see schema),
 *   - hash-chained: row_hash = sha256(prev_hash || canonical(row)),
 * so any mutation or deletion breaks the chain and is detectable.
 *
 * Audit tables are excluded from storage push/pull/sync (BUILD-SPEC §4.6).
 */
export const AUDIT_GENESIS_HASH = "0".repeat(64);

export interface AuditInput {
  entity_id?: string | null;
  actor_id: string;
  action: string;
  resource: string;
  resource_id?: string | null;
  detail?: string | null;
}

function canonical(fields: {
  entity_id: string | null;
  actor_id: string;
  action: string;
  resource: string;
  resource_id: string | null;
  detail: string | null;
  created_at: string;
  prev_hash: string;
}): string {
  return JSON.stringify([
    fields.entity_id,
    fields.actor_id,
    fields.action,
    fields.resource,
    fields.resource_id,
    fields.detail,
    fields.created_at,
    fields.prev_hash,
  ]);
}

export function computeRowHash(fields: Parameters<typeof canonical>[0]): string {
  return createHash("sha256").update(canonical(fields)).digest("hex");
}

function latestHash(db: Database): string {
  const row = db.query("SELECT row_hash FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 1").get() as
    | { row_hash: string }
    | null;
  return row?.row_hash ?? AUDIT_GENESIS_HASH;
}

/** Append an audit entry, chaining it onto the previous row's hash. */
export function appendAudit(db: Database, input: AuditInput): AuditRow {
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  const prev_hash = latestHash(db);
  const fields = {
    entity_id: input.entity_id ?? null,
    actor_id: input.actor_id,
    action: input.action,
    resource: input.resource,
    resource_id: input.resource_id ?? null,
    detail: input.detail ?? null,
    created_at,
    prev_hash,
  };
  const row_hash = computeRowHash(fields);
  db.run(
    `INSERT INTO audit_log (id, entity_id, actor_id, action, resource, resource_id, detail, prev_hash, row_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, fields.entity_id, fields.actor_id, fields.action, fields.resource, fields.resource_id, fields.detail, prev_hash, row_hash, created_at],
  );
  return { id, ...fields, row_hash };
}

export function listAudit(db: Database, entityIds?: string[]): AuditRow[] {
  const rows = db.query("SELECT * FROM audit_log ORDER BY created_at ASC, id ASC").all() as AuditRow[];
  if (!entityIds) return rows;
  const allowed = new Set(entityIds);
  return rows.filter((r) => r.entity_id === null || allowed.has(r.entity_id));
}

export interface ChainVerification {
  valid: boolean;
  broken_at: string | null;
  count: number;
}

/** Recompute the chain and report the first row whose hash does not match. */
export function verifyAuditChain(db: Database): ChainVerification {
  const rows = db.query("SELECT * FROM audit_log ORDER BY created_at ASC, id ASC").all() as AuditRow[];
  let prev = AUDIT_GENESIS_HASH;
  for (const row of rows) {
    const expected = computeRowHash({
      entity_id: row.entity_id,
      actor_id: row.actor_id,
      action: row.action,
      resource: row.resource,
      resource_id: row.resource_id,
      detail: row.detail,
      created_at: row.created_at,
      prev_hash: prev,
    });
    if (row.prev_hash !== prev || row.row_hash !== expected) {
      return { valid: false, broken_at: row.id, count: rows.length };
    }
    prev = row.row_hash;
  }
  return { valid: true, broken_at: null, count: rows.length };
}
