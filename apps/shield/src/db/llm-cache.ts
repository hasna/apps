import crypto from "crypto";
import { getDb } from "./database.js";
import { sanitizeTextForBoundary, sanitizeValueForBoundary } from "../lib/finding-safety.js";

export function getCachedAnalysis(
  fingerprint: string,
  analysis_type: string
): Record<string, unknown> | null {
  const db = getDb();
  const safeFingerprint = sanitizeTextForBoundary(fingerprint, 256);
  const safeAnalysisType = sanitizeTextForBoundary(analysis_type, 128);
  const stmt = db.prepare(
    `SELECT id, result, finding_fingerprint, analysis_type FROM llm_cache
     WHERE (finding_fingerprint = ? AND analysis_type = ?)
        OR (finding_fingerprint = ? AND analysis_type = ?)
     LIMIT 1`
  );
  const row = stmt.get(safeFingerprint, safeAnalysisType, fingerprint, analysis_type) as {
    id: string;
    result: string;
    finding_fingerprint: string;
    analysis_type: string;
  } | undefined;
  if (!row) return null;
  const safeResult = sanitizeValueForBoundary(JSON.parse(row.result) as Record<string, unknown>);
  const safeResultJson = JSON.stringify(safeResult);
  if (
    row.result !== safeResultJson ||
    row.finding_fingerprint !== safeFingerprint ||
    row.analysis_type !== safeAnalysisType
  ) {
    try {
      db.prepare(
        "UPDATE llm_cache SET finding_fingerprint = ?, analysis_type = ?, result = ? WHERE id = ?",
      ).run(safeFingerprint, safeAnalysisType, safeResultJson, row.id);
    } catch {
      // Return remains sanitized when legacy/read-only cache rows cannot change.
    }
  }
  return safeResult;
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
  const safeFingerprint = sanitizeTextForBoundary(fingerprint, 256);
  const safeAnalysisType = sanitizeTextForBoundary(analysis_type, 128);
  const resultJson = JSON.stringify(sanitizeValueForBoundary(result));
  const safeModel = sanitizeTextForBoundary(model, 256);

  const stmt = db.prepare(
    `INSERT INTO llm_cache (id, finding_fingerprint, analysis_type, result, model, tokens_used, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(finding_fingerprint, analysis_type) DO UPDATE SET
       result = excluded.result,
       model = excluded.model,
       tokens_used = excluded.tokens_used,
       created_at = excluded.created_at`
  );
  stmt.run(crypto.randomUUID(), safeFingerprint, safeAnalysisType, resultJson, safeModel, tokens_used, now);
}

export function invalidateCache(fingerprint?: string): void {
  const db = getDb();
  if (fingerprint) {
    const safeFingerprint = sanitizeTextForBoundary(fingerprint, 256);
    const stmt = db.prepare(`DELETE FROM llm_cache WHERE finding_fingerprint = ? OR finding_fingerprint = ?`);
    stmt.run(safeFingerprint, fingerprint);
  } else {
    db.prepare(`DELETE FROM llm_cache`).run();
  }
}
