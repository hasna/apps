import { createHash } from "node:crypto";
import type { QueryClient } from "./database.js";
import { now } from "./database.js";
import type { AuditEvent } from "../types/index.js";

// Append-only, tamper-evident audit (BUILD-SPEC §4.7). Rows are insert-only
// (enforced by DB triggers in schema.ts) and hash-chained:
//   row_hash = sha256(prev_hash || canonical(row))
// so any mutation/deletion breaks the chain and is detectable. Audit rows are
// NEVER included in storage_push/pull/sync.

const GENESIS = "0".repeat(64);

function canonical(fields: { entity_id: string | null; actor_id: string; action: string; detail: string; created_at: string }): string {
  return JSON.stringify([fields.entity_id, fields.actor_id, fields.action, fields.detail, fields.created_at]);
}

export interface AppendAuditInput {
  entity_id: string | null;
  actor_id: string;
  action: string;
  detail: string;
}

export async function appendAudit(db: QueryClient, input: AppendAuditInput): Promise<void> {
  // Serialize read-last + insert so the SHA-256 hash chain stays strictly linear.
  // SQLite is single-writer, but cloud Postgres has concurrent writers: without
  // this, two appends can read the same prev_hash and both insert, forking the
  // chain and producing a false-positive tamper alert in verifyAuditChain. The
  // transaction gives atomic read-compute-insert, and the UNIQUE(prev_hash)
  // index (schema.ts) is the cross-connection guard: a concurrent fork loses the
  // race and fails loudly with a unique-violation instead of silently forking.
  await db.transaction(async (tx) => {
    const last = await tx.get<{ row_hash: string }>("SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1");
    const prev_hash = last?.row_hash ?? GENESIS;
    const created_at = now();
    const fields = { entity_id: input.entity_id, actor_id: input.actor_id, action: input.action, detail: input.detail, created_at };
    const row_hash = createHash("sha256").update(prev_hash + canonical(fields)).digest("hex");
    await tx.run(
      "INSERT INTO audit_log (entity_id, actor_id, action, detail, prev_hash, row_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [fields.entity_id, fields.actor_id, fields.action, fields.detail, prev_hash, row_hash, created_at],
    );
  });
}

export async function listAudit(db: QueryClient, limit = 100): Promise<AuditEvent[]> {
  return db.all<AuditEvent>("SELECT * FROM audit_log ORDER BY id ASC LIMIT ?", [limit]);
}

/** Recompute the chain and report the first row whose hash does not verify. */
export async function verifyAuditChain(db: QueryClient): Promise<{ ok: boolean; brokenAt: number | null }> {
  const rows = await db.all<AuditEvent>("SELECT * FROM audit_log ORDER BY id ASC");
  let prev = GENESIS;
  for (const row of rows) {
    const expected = createHash("sha256")
      .update(prev + canonical({ entity_id: row.entity_id, actor_id: row.actor_id, action: row.action, detail: row.detail, created_at: row.created_at }))
      .digest("hex");
    if (expected !== row.row_hash || row.prev_hash !== prev) {
      return { ok: false, brokenAt: row.id };
    }
    prev = row.row_hash;
  }
  return { ok: true, brokenAt: null };
}
