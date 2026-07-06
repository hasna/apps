import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";

// Append-only, tamper-evident audit (§4.7). Every sensitive config lifecycle
// event (create/update/delete of SLOs, budgets, views, thresholds, annotations,
// plus storage push/pull/sync) is recorded as an insert-only, hash-chained row.
// The DB enforces immutability via triggers (see db/schema.ts). Any mutation or
// deletion breaks the hash chain and is detectable via verifyAuditChain().

const GENESIS_HASH = "0".repeat(64);

export interface AuditEvent {
  actor_id: string;
  action: string;
  resource: string;
  entity_id?: string | null;
  detail?: Record<string, unknown>;
}

export interface AuditRow {
  seq: number;
  id: string;
  at: string;
  actor_id: string;
  action: string;
  resource: string;
  entity_id: string | null;
  detail: string;
  prev_hash: string;
  row_hash: string;
}

function canonical(parts: {
  id: string;
  at: string;
  actor_id: string;
  action: string;
  resource: string;
  entity_id: string | null;
  detail: string;
}): string {
  // Stable field order — never reorder (the hash chain depends on it).
  return JSON.stringify([
    parts.id,
    parts.at,
    parts.actor_id,
    parts.action,
    parts.resource,
    parts.entity_id,
    parts.detail,
  ]);
}

function rowHash(prevHash: string, canon: string): string {
  return createHash("sha256").update(`${prevHash}\n${canon}`).digest("hex");
}

function lastHash(db: Database): string {
  const row = db.query("SELECT row_hash FROM fleet_audit ORDER BY seq DESC LIMIT 1").get() as
    | { row_hash: string }
    | null;
  return row?.row_hash ?? GENESIS_HASH;
}

/** Append one audit event; returns the persisted row. Insert-only. */
export function recordAudit(db: Database, event: AuditEvent): AuditRow {
  const id = crypto.randomUUID();
  const at = new Date().toISOString();
  const entity_id = event.entity_id ?? null;
  const detail = JSON.stringify(event.detail ?? {});
  const prev_hash = lastHash(db);
  const row_hash = rowHash(prev_hash, canonical({ id, at, actor_id: event.actor_id, action: event.action, resource: event.resource, entity_id, detail }));

  db.run(
    "INSERT INTO fleet_audit (id, at, actor_id, action, resource, entity_id, detail, prev_hash, row_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, at, event.actor_id, event.action, event.resource, entity_id, detail, prev_hash, row_hash],
  );

  return { seq: 0, id, at, actor_id: event.actor_id, action: event.action, resource: event.resource, entity_id, detail, prev_hash, row_hash };
}

export function listAudit(db: Database, limit = 100): AuditRow[] {
  return db.query("SELECT * FROM fleet_audit ORDER BY seq DESC LIMIT ?").all(limit) as AuditRow[];
}

export interface AuditChainVerification {
  valid: boolean;
  checked: number;
  brokenAtSeq?: number;
}

/** Recompute the hash chain from genesis and detect any tampering. */
export function verifyAuditChain(db: Database): AuditChainVerification {
  const rows = db.query("SELECT * FROM fleet_audit ORDER BY seq ASC").all() as AuditRow[];
  let prev = GENESIS_HASH;
  for (const row of rows) {
    const canon = canonical({
      id: row.id,
      at: row.at,
      actor_id: row.actor_id,
      action: row.action,
      resource: row.resource,
      entity_id: row.entity_id,
      detail: row.detail,
    });
    const expected = rowHash(prev, canon);
    if (row.prev_hash !== prev || row.row_hash !== expected) {
      return { valid: false, checked: rows.length, brokenAtSeq: row.seq };
    }
    prev = row.row_hash;
  }
  return { valid: true, checked: rows.length };
}
