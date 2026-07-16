import crypto from "crypto";
import { getDb } from "./database.js";
import type { Scan } from "../types/index.js";
import { ScanStatus, type ScannerType } from "../types/index.js";
import { sanitizeScanForOutput, sanitizeTextForBoundary } from "../lib/finding-safety.js";
import {
  legacyRowContainsCredential,
  scrubLegacyCredentialRows,
} from "./legacy-credential-scrub.js";
import { getProject } from "./projects.js";

interface ScanRow {
  id: string;
  project_id: string;
  status: string;
  scanner_types: string;
  findings_count: number;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

function rowToScan(row: ScanRow): Scan {
  return sanitizeScanForOutput({
    ...row,
    status: row.status as ScanStatus,
    scanner_types: JSON.parse(row.scanner_types) as ScannerType[],
  });
}

export function createScan(project_id: string, scanner_types: ScannerType[]): Scan {
  const db = getDb();
  const project = getProject(project_id);
  const targetProjectId = project?.id ?? project_id;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const safeScannerTypes = scanner_types.map((scannerType) =>
    sanitizeTextForBoundary(String(scannerType), 128) as ScannerType);
  const scannerTypesJson = JSON.stringify(safeScannerTypes);

  const stmt = db.prepare(
    `INSERT INTO scans (id, project_id, status, scanner_types, findings_count, started_at, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  );
  stmt.run(id, targetProjectId, ScanStatus.Pending, scannerTypesJson, now, now);

  return {
    id,
    project_id: targetProjectId,
    status: ScanStatus.Pending,
    scanner_types: safeScannerTypes,
    findings_count: 0,
    started_at: now,
    completed_at: null,
    duration_ms: null,
    error: null,
    created_at: now,
  };
}

export function getScan(id: string): Scan | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM scans WHERE id = ?`);
  let row = stmt.get(id) as ScanRow | undefined;
  if (row && legacyRowContainsCredential(row as unknown as Record<string, unknown>)) {
    const result = scrubLegacyCredentialRows(db);
    row = stmt.get(result.scanIds.get(id) ?? id) as ScanRow | undefined;
  }
  return row ? rowToScan(row) : null;
}

export function listScans(project_id?: string, limit: number = 50): Scan[] {
  const db = getDb();
  const migrateRows = (rows: ScanRow[]): ScanRow[] => {
    if (!rows.some((row) => legacyRowContainsCredential(row as unknown as Record<string, unknown>))) {
      return rows;
    }
    const result = scrubLegacyCredentialRows(db);
    return rows.flatMap((row) => {
      const migrated = db.prepare("SELECT * FROM scans WHERE id = ?")
        .get(result.scanIds.get(row.id) ?? row.id) as ScanRow | undefined;
      return migrated ? [migrated] : [];
    });
  };
  if (project_id) {
    const stmt = db.prepare(
      `SELECT * FROM scans WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`
    );
    return migrateRows(stmt.all(project_id, limit) as ScanRow[]).map(rowToScan);
  }
  const stmt = db.prepare(`SELECT * FROM scans ORDER BY created_at DESC LIMIT ?`);
  return migrateRows(stmt.all(limit) as ScanRow[]).map(rowToScan);
}

export function updateScanStatus(
  id: string,
  status: ScanStatus,
  findings_count?: number,
  error?: string
): void {
  const db = getDb();
  const scan = getScan(id);
  const targetId = scan?.id ?? id;
  const stmt = db.prepare(
    `UPDATE scans SET status = ?, findings_count = COALESCE(?, findings_count), error = COALESCE(?, error)
     WHERE id = ?`
  );
  const safeError = error == null ? null : sanitizeTextForBoundary(error);
  const safeStatus = sanitizeTextForBoundary(String(status), 128) as ScanStatus;
  stmt.run(safeStatus, findings_count ?? null, safeError, targetId);
}

export function completeScan(id: string, findings_count: number): void {
  const db = getDb();
  const now = new Date().toISOString();

  const scan = getScan(id);
  const targetId = scan?.id ?? id;
  const duration_ms = scan
    ? new Date(now).getTime() - new Date(scan.started_at).getTime()
    : null;

  const stmt = db.prepare(
    `UPDATE scans SET status = ?, findings_count = ?, completed_at = ?, duration_ms = ? WHERE id = ?`
  );
  stmt.run(ScanStatus.Completed, findings_count, now, duration_ms, targetId);
}

export function deleteScan(id: string): void {
  const db = getDb();
  const scan = getScan(id);
  const stmt = db.prepare(`DELETE FROM scans WHERE id = ?`);
  stmt.run(scan?.id ?? id);
}
