import crypto from "crypto";
import { getDb } from "./database.js";
import type { Baseline } from "../types/index.js";
import {
  sanitizeFingerprintForOutput,
  sanitizeIdentifierForOutput,
  sanitizeTextForBoundary,
} from "../lib/finding-safety.js";
import {
  legacyRowContainsCredential,
  scrubLegacyCredentialRows,
} from "./legacy-credential-scrub.js";

function sanitizeBaseline(row: Baseline): Baseline {
  return {
    id: sanitizeIdentifierForOutput(row.id, "BASELINE-ID"),
    finding_fingerprint: sanitizeFingerprintForOutput(row.finding_fingerprint),
    reason: sanitizeTextForBoundary(row.reason),
    created_by: sanitizeTextForBoundary(row.created_by, 256),
    created_at: sanitizeTextForBoundary(row.created_at, 128),
  };
}

export function createBaseline(
  fingerprint: string,
  reason: string,
  created_by: string = "system"
): Baseline {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const baseline = sanitizeBaseline({
    id,
    finding_fingerprint: fingerprint,
    reason,
    created_by,
    created_at: now,
  });

  const stmt = db.prepare(
    `INSERT INTO baselines (id, finding_fingerprint, reason, created_by, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  stmt.run(
    baseline.id,
    baseline.finding_fingerprint,
    baseline.reason,
    baseline.created_by,
    baseline.created_at,
  );

  return baseline;
}

export function listBaselines(): Baseline[] {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM baselines ORDER BY created_at DESC`);
  let rows = stmt.all() as Baseline[];
  if (rows.some((row) => legacyRowContainsCredential(
    row as unknown as Record<string, unknown>,
  ))) {
    scrubLegacyCredentialRows(db);
    rows = stmt.all() as Baseline[];
  }
  return rows.map(sanitizeBaseline);
}

export function isBaselined(fingerprint: string): boolean {
  const db = getDb();
  const safeFingerprint = sanitizeFingerprintForOutput(fingerprint);
  const stmt = db.prepare(
    `SELECT COUNT(*) as count FROM baselines
     WHERE finding_fingerprint = ? OR finding_fingerprint = ?`
  );
  const row = stmt.get(safeFingerprint, fingerprint) as { count: number };
  return row.count > 0;
}

export function deleteBaseline(id: string): void {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM baselines WHERE id = ?`);
  stmt.run(id);
}
