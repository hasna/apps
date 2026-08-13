import { createHash } from "node:crypto";

// Append-only, tamper-evident audit chain helpers (money/lifecycle events).
// Each row stores prev_hash and row_hash = sha256(prev_hash || canonical(row)).
// Any mutation/deletion breaks the chain and is detected by verifyAuditChain.

export const AUDIT_GENESIS = "GENESIS";
export const AUDIT_TABLE = "audit_log";

/** Deterministic JSON with sorted keys — stable input for hashing. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export interface AuditPayload {
  event: string;
  actor_id: string;
  entity_id: string | null;
  detail: string;
  created_at: string;
}

/** Compute the row hash for an audit payload chained on prevHash. */
export function computeRowHash(prevHash: string, payload: AuditPayload): string {
  return createHash("sha256").update(prevHash + canonical(payload)).digest("hex");
}

export interface AuditChainRow extends AuditPayload {
  id: number;
  prev_hash: string;
  row_hash: string;
}

export interface ChainVerification {
  ok: boolean;
  brokenAt: number | null;
}

/** Verify the full hash chain of ordered audit rows. */
export function verifyAuditChain(rows: AuditChainRow[]): ChainVerification {
  let prev = AUDIT_GENESIS;
  for (const row of rows) {
    const payload: AuditPayload = {
      event: row.event,
      actor_id: row.actor_id,
      entity_id: row.entity_id,
      detail: row.detail,
      created_at: row.created_at,
    };
    if (row.prev_hash !== prev || row.row_hash !== computeRowHash(prev, payload)) {
      return { ok: false, brokenAt: row.id };
    }
    prev = row.row_hash;
  }
  return { ok: true, brokenAt: null };
}
