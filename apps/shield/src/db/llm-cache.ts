import crypto from "crypto";
import { getDb } from "./database.js";
import {
  sanitizeFingerprintForOutput,
  sanitizeTextForBoundary,
  sanitizeValueForBoundary,
} from "../lib/finding-safety.js";
import {
  legacyRowContainsCredential,
  sanitizeCachedResultText,
  scrubLegacyCredentialRows,
} from "./legacy-credential-scrub.js";

interface CacheRow extends Record<string, unknown> {
  id: string;
  result: string;
  finding_fingerprint: string;
  analysis_type: string;
}

export function getCachedAnalysis(
  fingerprint: string,
  analysis_type: string
): Record<string, unknown> | null {
  const db = getDb();
  const safeFingerprint = sanitizeFingerprintForOutput(fingerprint);
  const safeAnalysisType = sanitizeTextForBoundary(analysis_type, 128);
  const rawStmt = db.prepare(
    `SELECT * FROM llm_cache WHERE finding_fingerprint = ? AND analysis_type = ? LIMIT 1`,
  );
  const safeStmt = db.prepare(
    `SELECT * FROM llm_cache WHERE finding_fingerprint = ? AND analysis_type = ? LIMIT 1`,
  );
  const readRawRow = () => rawStmt.get(fingerprint, analysis_type) as CacheRow | undefined;
  const readSafeRow = () => safeStmt.get(
    safeFingerprint,
    safeAnalysisType,
  ) as CacheRow | undefined;
  let row = readRawRow();
  if (row && legacyRowContainsCredential(row)) {
    scrubLegacyCredentialRows(db);
    row = readSafeRow();
  } else if (!row) {
    row = readSafeRow();
  }
  if (row && legacyRowContainsCredential(row)) {
    scrubLegacyCredentialRows(db);
    row = readSafeRow();
  }
  if (!row) return null;
  const safeResultJson = sanitizeCachedResultText(row.result);
  const safeResult = JSON.parse(safeResultJson) as Record<string, unknown>;
  if (
    row.result !== safeResultJson
  ) {
    try {
      db.prepare("UPDATE llm_cache SET result = ? WHERE id = ?")
        .run(safeResultJson, row.id);
    } catch {
      throw new Error("Unable to durably sanitize legacy LLM cache data");
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
  const safeFingerprint = sanitizeFingerprintForOutput(fingerprint);
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
    const safeFingerprint = sanitizeFingerprintForOutput(fingerprint);
    const stmt = db.prepare(`DELETE FROM llm_cache WHERE finding_fingerprint = ? OR finding_fingerprint = ?`);
    stmt.run(safeFingerprint, fingerprint);
  } else {
    db.prepare(`DELETE FROM llm_cache`).run();
  }
}
