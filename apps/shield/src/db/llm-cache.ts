import crypto from "crypto";
import { getDb } from "./database.js";

export function getCachedAnalysis(
  fingerprint: string,
  analysis_type: string
): Record<string, unknown> | null {
  const db = getDb();
  const stmt = db.prepare(
    `SELECT result FROM llm_cache WHERE finding_fingerprint = ? AND analysis_type = ?`
  );
  const row = stmt.get(fingerprint, analysis_type) as { result: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.result) as Record<string, unknown>;
}

export function cacheAnalysis(
  fingerprint: string,
  analysis_type: string,
  result: Record<string, unknown>,
  model: string,
  tokens_used: number
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const resultJson = JSON.stringify(result);

  const stmt = db.prepare(
    `INSERT INTO llm_cache (id, finding_fingerprint, analysis_type, result, model, tokens_used, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(finding_fingerprint, analysis_type) DO UPDATE SET
       result = excluded.result,
       model = excluded.model,
       tokens_used = excluded.tokens_used,
       created_at = excluded.created_at`
  );
  stmt.run(crypto.randomUUID(), fingerprint, analysis_type, resultJson, model, tokens_used, now);
}

export function invalidateCache(fingerprint?: string): void {
  const db = getDb();
  if (fingerprint) {
    const stmt = db.prepare(`DELETE FROM llm_cache WHERE finding_fingerprint = ?`);
    stmt.run(fingerprint);
  } else {
    db.prepare(`DELETE FROM llm_cache`).run();
  }
}
