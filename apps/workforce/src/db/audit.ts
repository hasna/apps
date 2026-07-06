import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { LifecycleEvent, LifecycleEventType } from "../types/index.js";
import { now, uuid } from "./database.js";

// Append-only, tamper-evident lifecycle audit (§4.7).
//
// Each row stores prev_hash and row_hash = sha256(prev_hash || canonical(row)),
// forming a hash chain across ALL lifecycle_events (global chain). Any mutation
// or deletion breaks the chain and is detectable by verifyLifecycleChain().
// UPDATE/DELETE are additionally blocked by SQLite triggers (see schema.ts).

const GENESIS_HASH = "0".repeat(64);

export interface AppendLifecycleInput {
  member_id: string;
  event_type: LifecycleEventType;
  effective_date: string;
  from_role?: string | null;
  to_role?: string | null;
  reason?: string | null;
}

interface HashPayload {
  id: string;
  member_id: string;
  event_type: LifecycleEventType;
  effective_date: string;
  from_role: string | null;
  to_role: string | null;
  reason: string | null;
  recorded_at: string;
}

/** Deterministic canonical JSON (stable key order) for hashing. */
function canonical(payload: HashPayload): string {
  const keys = Object.keys(payload).sort() as (keyof HashPayload)[];
  return JSON.stringify(keys.map((k) => [k, payload[k]]));
}

function computeRowHash(prevHash: string, payload: HashPayload): string {
  return createHash("sha256").update(prevHash + "|" + canonical(payload)).digest("hex");
}

function latestHash(db: Database): string {
  const row = db
    .query("SELECT row_hash FROM lifecycle_events ORDER BY recorded_at DESC, id DESC LIMIT 1")
    .get() as { row_hash: string } | null;
  return row?.row_hash ?? GENESIS_HASH;
}

/** Append a lifecycle event to the tamper-evident chain and return the stored row. */
export function appendLifecycleEvent(db: Database, input: AppendLifecycleInput): LifecycleEvent {
  const id = uuid();
  const recorded_at = now();
  const prev_hash = latestHash(db);
  const payload: HashPayload = {
    id,
    member_id: input.member_id,
    event_type: input.event_type,
    effective_date: input.effective_date,
    from_role: input.from_role ?? null,
    to_role: input.to_role ?? null,
    reason: input.reason ?? null,
    recorded_at,
  };
  const row_hash = computeRowHash(prev_hash, payload);
  db.query(
    `INSERT INTO lifecycle_events (id, member_id, event_type, effective_date, from_role, to_role, reason, recorded_at, prev_hash, row_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    payload.member_id,
    payload.event_type,
    payload.effective_date,
    payload.from_role,
    payload.to_role,
    payload.reason,
    recorded_at,
    prev_hash,
    row_hash,
  );
  return { ...payload, prev_hash, row_hash };
}

export function listLifecycleEvents(db: Database, memberId?: string): LifecycleEvent[] {
  const rows = memberId
    ? db.query("SELECT * FROM lifecycle_events WHERE member_id = ? ORDER BY recorded_at ASC, id ASC").all(memberId)
    : db.query("SELECT * FROM lifecycle_events ORDER BY recorded_at ASC, id ASC").all();
  return rows as LifecycleEvent[];
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  broken_at?: string;
  reason?: string;
}

/** Recompute the full hash chain and report the first break (if any). */
export function verifyLifecycleChain(db: Database): ChainVerification {
  const rows = db
    .query("SELECT * FROM lifecycle_events ORDER BY recorded_at ASC, id ASC")
    .all() as LifecycleEvent[];
  let prev = GENESIS_HASH;
  let checked = 0;
  for (const row of rows) {
    checked += 1;
    if (row.prev_hash !== prev) {
      return { valid: false, checked, broken_at: row.id, reason: "prev_hash does not match chain" };
    }
    const expected = computeRowHash(prev, {
      id: row.id,
      member_id: row.member_id,
      event_type: row.event_type,
      effective_date: row.effective_date,
      from_role: row.from_role,
      to_role: row.to_role,
      reason: row.reason,
      recorded_at: row.recorded_at,
    });
    if (expected !== row.row_hash) {
      return { valid: false, checked, broken_at: row.id, reason: "row_hash mismatch (row was tampered)" };
    }
    prev = row.row_hash;
  }
  return { valid: true, checked };
}
