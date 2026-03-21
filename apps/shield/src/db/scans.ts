import crypto from "crypto";
import { getDb } from "./database.js";
import type { Scan } from "../types/index.js";
import { ScanStatus, type ScannerType } from "../types/index.js";

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
  return {
    ...row,
    status: row.status as ScanStatus,
    scanner_types: JSON.parse(row.scanner_types) as ScannerType[],
  };
}

export function createScan(project_id: string, scanner_types: ScannerType[]): Scan {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const scannerTypesJson = JSON.stringify(scanner_types);

  const stmt = db.prepare(
    `INSERT INTO scans (id, project_id, status, scanner_types, findings_count, started_at, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  );
  stmt.run(id, project_id, ScanStatus.Pending, scannerTypesJson, now, now);

  return {
    id,
    project_id,
    status: ScanStatus.Pending,
    scanner_types,
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
  const row = stmt.get(id) as ScanRow | undefined;
  return row ? rowToScan(row) : null;
}

export function listScans(project_id?: string, limit: number = 50): Scan[] {
  const db = getDb();
  if (project_id) {
    const stmt = db.prepare(
      `SELECT * FROM scans WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`
    );
    return (stmt.all(project_id, limit) as ScanRow[]).map(rowToScan);
  }
  const stmt = db.prepare(`SELECT * FROM scans ORDER BY created_at DESC LIMIT ?`);
  return (stmt.all(limit) as ScanRow[]).map(rowToScan);
}

export function updateScanStatus(
  id: string,
  status: ScanStatus,
  findings_count?: number,
  error?: string
): void {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE scans SET status = ?, findings_count = COALESCE(?, findings_count), error = COALESCE(?, error)
     WHERE id = ?`
  );
  stmt.run(status, findings_count ?? null, error ?? null, id);
}

export function completeScan(id: string, findings_count: number): void {
  const db = getDb();
  const now = new Date().toISOString();

  const scan = getScan(id);
  const duration_ms = scan
    ? new Date(now).getTime() - new Date(scan.started_at).getTime()
    : null;

  const stmt = db.prepare(
    `UPDATE scans SET status = ?, findings_count = ?, completed_at = ?, duration_ms = ? WHERE id = ?`
  );
  stmt.run(ScanStatus.Completed, findings_count, now, duration_ms, id);
}

export function deleteScan(id: string): void {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM scans WHERE id = ?`);
  stmt.run(id);
}
