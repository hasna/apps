import crypto from "crypto";
import { createHash } from "crypto";
import { getDb } from "./database.js";
import type { Finding, FindingInput, SecurityScore } from "../types/index.js";
import { Severity, type ScannerType } from "../types/index.js";

interface FindingRow {
  id: string;
  scan_id: string;
  rule_id: string;
  scanner_type: string;
  severity: string;
  file: string;
  line: number;
  column: number | null;
  end_line: number | null;
  message: string;
  code_snippet: string | null;
  fingerprint: string;
  suppressed: number;
  suppressed_reason: string | null;
  llm_explanation: string | null;
  llm_fix: string | null;
  llm_exploitability: number | null;
  created_at: string;
}

function rowToFinding(row: FindingRow): Finding {
  return {
    ...row,
    scanner_type: row.scanner_type as ScannerType,
    severity: row.severity as Severity,
    suppressed: row.suppressed === 1,
  };
}

function generateFingerprint(rule_id: string, file: string, line: number, message: string): string {
  return createHash("sha256")
    .update(rule_id + file + line + message)
    .digest("hex")
    .slice(0, 16);
}

export function createFinding(scan_id: string, input: FindingInput): Finding {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const fingerprint = generateFingerprint(input.rule_id, input.file, input.line, input.message);

  const stmt = db.prepare(
    `INSERT INTO findings (id, scan_id, rule_id, scanner_type, severity, file, line, "column", end_line, message, code_snippet, fingerprint, suppressed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  );
  stmt.run(
    id,
    scan_id,
    input.rule_id,
    input.scanner_type,
    input.severity,
    input.file,
    input.line,
    input.column ?? null,
    input.end_line ?? null,
    input.message,
    input.code_snippet ?? null,
    fingerprint,
    now
  );

  return {
    id,
    scan_id,
    rule_id: input.rule_id,
    scanner_type: input.scanner_type,
    severity: input.severity,
    file: input.file,
    line: input.line,
    column: input.column ?? null,
    end_line: input.end_line ?? null,
    message: input.message,
    code_snippet: input.code_snippet ?? null,
    fingerprint,
    suppressed: false,
    suppressed_reason: null,
    llm_explanation: null,
    llm_fix: null,
    llm_exploitability: null,
    created_at: now,
  };
}

export function getFinding(id: string): Finding | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM findings WHERE id = ?`);
  const row = stmt.get(id) as FindingRow | undefined;
  return row ? rowToFinding(row) : null;
}

export interface ListFindingsOptions {
  scan_id?: string;
  severity?: Severity;
  scanner_type?: ScannerType;
  file?: string;
  suppressed?: boolean;
  limit?: number;
  offset?: number;
}

export function listFindings(options: ListFindingsOptions = {}): Finding[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.scan_id) {
    conditions.push("scan_id = ?");
    params.push(options.scan_id);
  }
  if (options.severity) {
    conditions.push("severity = ?");
    params.push(options.severity);
  }
  if (options.scanner_type) {
    conditions.push("scanner_type = ?");
    params.push(options.scanner_type);
  }
  if (options.file) {
    conditions.push("file = ?");
    params.push(options.file);
  }
  if (options.suppressed !== undefined) {
    conditions.push("suppressed = ?");
    params.push(options.suppressed ? 1 : 0);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;

  const stmt = db.prepare(
    `SELECT * FROM findings ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  );
  params.push(limit, offset);

  return (stmt.all(...params) as FindingRow[]).map(rowToFinding);
}

export function updateFinding(
  id: string,
  updates: Partial<Pick<Finding, "suppressed" | "suppressed_reason" | "llm_explanation" | "llm_fix" | "llm_exploitability">>
): void {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.suppressed !== undefined) {
    sets.push("suppressed = ?");
    params.push(updates.suppressed ? 1 : 0);
  }
  if (updates.suppressed_reason !== undefined) {
    sets.push("suppressed_reason = ?");
    params.push(updates.suppressed_reason);
  }
  if (updates.llm_explanation !== undefined) {
    sets.push("llm_explanation = ?");
    params.push(updates.llm_explanation);
  }
  if (updates.llm_fix !== undefined) {
    sets.push("llm_fix = ?");
    params.push(updates.llm_fix);
  }
  if (updates.llm_exploitability !== undefined) {
    sets.push("llm_exploitability = ?");
    params.push(updates.llm_exploitability);
  }

  if (sets.length === 0) return;

  params.push(id);
  const stmt = db.prepare(`UPDATE findings SET ${sets.join(", ")} WHERE id = ?`);
  stmt.run(...params);
}

export function suppressFinding(id: string, reason: string): void {
  updateFinding(id, { suppressed: true, suppressed_reason: reason });
}

export function countFindings(scan_id?: string, severity?: Severity): number {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (scan_id) {
    conditions.push("scan_id = ?");
    params.push(scan_id);
  }
  if (severity) {
    conditions.push("severity = ?");
    params.push(severity);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const stmt = db.prepare(`SELECT COUNT(*) as count FROM findings ${where}`);
  const row = stmt.get(...params) as { count: number };
  return row.count;
}

export function getSecurityScore(scan_id: string): SecurityScore {
  const db = getDb();

  const countStmt = db.prepare(
    `SELECT severity, COUNT(*) as count FROM findings WHERE scan_id = ? AND suppressed = 0 GROUP BY severity`
  );
  const rows = countStmt.all(scan_id) as Array<{ severity: string; count: number }>;

  const suppressedStmt = db.prepare(
    `SELECT COUNT(*) as count FROM findings WHERE scan_id = ? AND suppressed = 1`
  );
  const suppressedRow = suppressedStmt.get(scan_id) as { count: number };

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.severity] = row.count;
  }

  const critical = counts[Severity.Critical] ?? 0;
  const high = counts[Severity.High] ?? 0;
  const medium = counts[Severity.Medium] ?? 0;
  const low = counts[Severity.Low] ?? 0;
  const info = counts[Severity.Info] ?? 0;
  const suppressed = suppressedRow.count;
  const total_findings = critical + high + medium + low + info;

  // Score: start at 100, deduct based on severity
  // Critical: -20 each, High: -10, Medium: -5, Low: -2, Info: -1
  const deductions = critical * 20 + high * 10 + medium * 5 + low * 2 + info * 1;
  const score = Math.max(0, 100 - deductions);

  return {
    total_findings,
    critical,
    high,
    medium,
    low,
    info,
    suppressed,
    score,
  };
}
