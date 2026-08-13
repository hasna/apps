import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { AUDIT_TABLE } from "./schema.js";
import type { AuditEvent } from "../types/index.js";

/**
 * Append-only, tamper-evident audit log (§4.7). Each row stores prev_hash and
 * row_hash = sha256(prev_hash || canonical(row)). UPDATE/DELETE are blocked by
 * SQLite triggers (see schema.ts). Any mutation/deletion breaks the chain and
 * is detectable via verifyAuditChain().
 */

const GENESIS = "0".repeat(64);

interface AuditInput {
  entity_id?: string | null;
  event_type: string;
  actor?: string | null;
  payload: Record<string, unknown>;
}

function canonical(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const normalized: Record<string, unknown> = {};
  for (const key of keys) normalized[key] = obj[key];
  return JSON.stringify(normalized);
}

function computeRowHash(prevHash: string, entityId: string | null, eventType: string, actor: string | null, payload: Record<string, unknown>, createdAt: string): string {
  const body = canonical({
    entity_id: entityId,
    event_type: eventType,
    actor,
    payload,
    created_at: createdAt,
  });
  return createHash("sha256").update(`${prevHash}${body}`).digest("hex");
}

function lastRowHash(db: Database): string {
  const row = db.query(`SELECT row_hash FROM ${AUDIT_TABLE} ORDER BY id DESC LIMIT 1`).get() as { row_hash: string } | null;
  return row?.row_hash ?? GENESIS;
}

export function appendAuditEvent(db: Database, input: AuditInput): AuditEvent {
  const createdAt = new Date().toISOString();
  const entityId = input.entity_id ?? null;
  const actor = input.actor ?? null;
  const prevHash = lastRowHash(db);
  const rowHash = computeRowHash(prevHash, entityId, input.event_type, actor, input.payload, createdAt);
  db.query(
    `INSERT INTO ${AUDIT_TABLE} (entity_id, event_type, actor, payload, prev_hash, row_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(entityId, input.event_type, actor, JSON.stringify(input.payload), prevHash, rowHash, createdAt);
  const id = (db.query(`SELECT last_insert_rowid() AS id`).get() as { id: number }).id;
  return { id, entity_id: entityId, event_type: input.event_type, actor, payload: input.payload, prev_hash: prevHash, row_hash: rowHash, created_at: createdAt };
}

interface AuditRow {
  id: number;
  entity_id: string | null;
  event_type: string;
  actor: string | null;
  payload: string;
  prev_hash: string;
  row_hash: string;
  created_at: string;
}

export function listAuditEvents(
  db: Database,
  opts: { entity_id?: string; entity_ids?: string[] | null; limit?: number } = {},
): AuditEvent[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (opts.entity_id) {
    clauses.push("entity_id = ?");
    params.push(opts.entity_id);
  }
  // Deny-by-default: an entity-scoped principal only ever sees its own entities'
  // audit rows, even when it supplies no explicit entity_id filter. `null` =>
  // unconstrained (system/owner/admin); an empty allowlist => no rows.
  if (opts.entity_ids !== undefined && opts.entity_ids !== null) {
    if (opts.entity_ids.length === 0) return [];
    clauses.push(`entity_id IN (${opts.entity_ids.map(() => "?").join(", ")})`);
    params.push(...opts.entity_ids);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .query(`SELECT * FROM ${AUDIT_TABLE} ${where} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit) as AuditRow[];
  return rows.map(toEvent);
}

function toEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    entity_id: row.entity_id,
    event_type: row.event_type,
    actor: row.actor,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    prev_hash: row.prev_hash,
    row_hash: row.row_hash,
    created_at: row.created_at,
  };
}

export interface ChainVerification {
  valid: boolean;
  count: number;
  brokenAt?: number;
}

/** Recompute the hash chain from genesis and report the first break, if any. */
export function verifyAuditChain(db: Database): ChainVerification {
  const rows = db.query(`SELECT * FROM ${AUDIT_TABLE} ORDER BY id ASC`).all() as AuditRow[];
  let prev = GENESIS;
  for (const row of rows) {
    if (row.prev_hash !== prev) return { valid: false, count: rows.length, brokenAt: row.id };
    const expected = computeRowHash(prev, row.entity_id, row.event_type, row.actor, JSON.parse(row.payload) as Record<string, unknown>, row.created_at);
    if (expected !== row.row_hash) return { valid: false, count: rows.length, brokenAt: row.id };
    prev = row.row_hash;
  }
  return { valid: true, count: rows.length };
}
