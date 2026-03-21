import crypto from "crypto";
import { getDb } from "./database.js";
import type { Baseline } from "../types/index.js";

export function createBaseline(
  fingerprint: string,
  reason: string,
  created_by: string = "system"
): Baseline {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const stmt = db.prepare(
    `INSERT INTO baselines (id, finding_fingerprint, reason, created_by, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  stmt.run(id, fingerprint, reason, created_by, now);

  return {
    id,
    finding_fingerprint: fingerprint,
    reason,
    created_by,
    created_at: now,
  };
}

export function listBaselines(): Baseline[] {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM baselines ORDER BY created_at DESC`);
  return stmt.all() as Baseline[];
}

export function isBaselined(fingerprint: string): boolean {
  const db = getDb();
  const stmt = db.prepare(
    `SELECT COUNT(*) as count FROM baselines WHERE finding_fingerprint = ?`
  );
  const row = stmt.get(fingerprint) as { count: number };
  return row.count > 0;
}

export function deleteBaseline(id: string): void {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM baselines WHERE id = ?`);
  stmt.run(id);
}
