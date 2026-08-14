import { createHash, randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { AuditEvent } from "../types/index.js";

// Append-only, tamper-evident audit ledger (§4.7). Each row stores prev_hash and
// row_hash = sha256(prev_hash || canonical(row)); any mutation/deletion is detectable.

export interface AuditInput {
  action: string;
  resource: string;
  resource_id?: string | null;
  actor_id: string;
  entity_id?: string | null;
  payload?: Record<string, unknown>;
}

function canonical(fields: Record<string, unknown>): string {
  return JSON.stringify(fields, Object.keys(fields).sort());
}

function latestHash(db: Database): string {
  const row = db
    .query<{ row_hash: string }, []>("SELECT row_hash FROM audit_events ORDER BY id DESC LIMIT 1")
    .get();
  return row?.row_hash ?? "GENESIS";
}

/** Append an audit event, chaining it to the previous row's hash. */
export function appendAudit(db: Database, input: AuditInput): AuditEvent {
  const event_id = randomUUID();
  const created_at = new Date().toISOString();
  const payload = JSON.stringify(input.payload ?? {});
  const prev_hash = latestHash(db);
  const entity_id = input.entity_id ?? null;
  const resource_id = input.resource_id ?? null;
  const row_hash = createHash("sha256")
    .update(
      prev_hash +
        canonical({
          event_id,
          entity_id,
          action: input.action,
          resource: input.resource,
          resource_id,
          actor_id: input.actor_id,
          payload,
          created_at,
        }),
    )
    .digest("hex");

  db.query(
    `INSERT INTO audit_events (event_id, entity_id, action, resource, resource_id, actor_id, payload, prev_hash, row_hash, created_at)
     VALUES ($event_id, $entity_id, $action, $resource, $resource_id, $actor_id, $payload, $prev_hash, $row_hash, $created_at)`,
  ).run({
    $event_id: event_id,
    $entity_id: entity_id,
    $action: input.action,
    $resource: input.resource,
    $resource_id: resource_id,
    $actor_id: input.actor_id,
    $payload: payload,
    $prev_hash: prev_hash,
    $row_hash: row_hash,
    $created_at: created_at,
  });

  return db
    .query<AuditEvent, [string]>("SELECT * FROM audit_events WHERE event_id = ?")
    .get(event_id)!;
}

export function listAudit(db: Database, limit = 100): AuditEvent[] {
  return db.query<AuditEvent, [number]>("SELECT * FROM audit_events ORDER BY id ASC LIMIT ?").all(limit);
}

/** Recompute the chain and confirm no row was tampered with. */
export function verifyAuditChain(db: Database): { ok: boolean; brokenAt?: string } {
  const rows = db.query<AuditEvent, []>("SELECT * FROM audit_events ORDER BY id ASC").all();
  let prev = "GENESIS";
  for (const row of rows) {
    const expected = createHash("sha256")
      .update(
        prev +
          canonical({
            event_id: row.event_id,
            entity_id: row.entity_id,
            action: row.action,
            resource: row.resource,
            resource_id: row.resource_id,
            actor_id: row.actor_id,
            payload: row.payload,
            created_at: row.created_at,
          }),
      )
      .digest("hex");
    if (row.prev_hash !== prev || row.row_hash !== expected) {
      return { ok: false, brokenAt: row.event_id };
    }
    prev = row.row_hash;
  }
  return { ok: true };
}
