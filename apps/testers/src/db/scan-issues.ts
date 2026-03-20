import { type PersistedScanIssue, type ScanIssue, type ScanIssueRow, scanIssueFromRow } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

// ─── Fingerprinting ───────────────────────────────────────────────────────────

/**
 * Derive a stable fingerprint from an issue.
 * Normalises the page URL to its pathname (ignores query/fragment) so the same
 * error on foo.com/page?x=1 and foo.com/page?x=2 is treated as the same issue.
 */
export function fingerprintIssue(issue: ScanIssue): string {
  let pagePattern = issue.pageUrl;
  try {
    pagePattern = new URL(issue.pageUrl).pathname;
  } catch {
    // Not a valid URL — use as-is
  }
  const raw = `${issue.type}::${issue.message.slice(0, 200)}::${pagePattern}`;
  // Simple deterministic hash (djb2)
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return `${issue.type}-${hash.toString(16).padStart(8, "0")}`;
}

// ─── Upsert logic ─────────────────────────────────────────────────────────────

export type UpsertOutcome = "new" | "existing" | "regressed";

export interface UpsertResult {
  issue: PersistedScanIssue;
  outcome: UpsertOutcome;
}

/**
 * Upsert a scan issue by fingerprint:
 * - New (never seen): insert with status=open
 * - Known open: bump occurrence_count + last_seen_at
 * - Known resolved: mark as regressed (status=regressed, increment count)
 */
export function upsertScanIssue(
  issue: ScanIssue,
  projectId?: string,
): UpsertResult {
  const db = getDatabase();
  const fingerprint = fingerprintIssue(issue);
  const timestamp = now();

  const existing = db
    .query("SELECT * FROM scan_issues WHERE fingerprint = ?")
    .get(fingerprint) as ScanIssueRow | null;

  if (!existing) {
    const id = uuid();
    db.query(`
      INSERT INTO scan_issues (id, fingerprint, type, severity, page_url, message, detail, status, occurrence_count, first_seen_at, last_seen_at, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 1, ?, ?, ?)
    `).run(
      id, fingerprint,
      issue.type, issue.severity, issue.pageUrl, issue.message,
      issue.detail ? JSON.stringify(issue.detail) : null,
      timestamp, timestamp, projectId ?? null,
    );
    const row = db.query("SELECT * FROM scan_issues WHERE id = ?").get(id) as ScanIssueRow;
    return { issue: scanIssueFromRow(row), outcome: "new" };
  }

  const wasResolved = existing.status === "resolved";
  const newStatus = wasResolved ? "regressed" : "open";

  db.query(`
    UPDATE scan_issues
    SET occurrence_count = occurrence_count + 1,
        last_seen_at = ?,
        status = ?,
        resolved_at = CASE WHEN ? = 'regressed' THEN NULL ELSE resolved_at END,
        severity = ?,
        page_url = ?,
        message = ?,
        detail = ?
    WHERE fingerprint = ?
  `).run(
    timestamp, newStatus, newStatus,
    issue.severity, issue.pageUrl, issue.message,
    issue.detail ? JSON.stringify(issue.detail) : existing.detail,
    fingerprint,
  );

  const updated = db
    .query("SELECT * FROM scan_issues WHERE fingerprint = ?")
    .get(fingerprint) as ScanIssueRow;
  return {
    issue: scanIssueFromRow(updated),
    outcome: wasResolved ? "regressed" : "existing",
  };
}

export function resolveScanIssue(id: string): boolean {
  const db = getDatabase();
  const result = db
    .query("UPDATE scan_issues SET status = 'resolved', resolved_at = ? WHERE id = ?")
    .run(now(), id) as { changes: number };
  return result.changes > 0;
}

export function setScanIssueTodoTaskId(id: string, todoTaskId: string): void {
  const db = getDatabase();
  db.query("UPDATE scan_issues SET todo_task_id = ? WHERE id = ?").run(todoTaskId, id);
}

export function listScanIssues(opts: {
  status?: string;
  type?: string;
  projectId?: string;
  limit?: number;
} = {}): PersistedScanIssue[] {
  const db = getDatabase();
  const conditions: string[] = ["1=1"];
  const params: string[] = [];

  if (opts.status) { conditions.push("status = ?"); params.push(opts.status); }
  if (opts.type)   { conditions.push("type = ?");   params.push(opts.type); }
  if (opts.projectId) { conditions.push("project_id = ?"); params.push(opts.projectId); }

  const limitClause = opts.limit ? ` LIMIT ${opts.limit}` : "";
  const rows = db
    .query(`SELECT * FROM scan_issues WHERE ${conditions.join(" AND ")} ORDER BY last_seen_at DESC${limitClause}`)
    .all(...params) as ScanIssueRow[];
  return rows.map(scanIssueFromRow);
}

export function getScanIssue(id: string): PersistedScanIssue | null {
  const db = getDatabase();
  const row = db.query("SELECT * FROM scan_issues WHERE id = ?").get(id) as ScanIssueRow | null;
  return row ? scanIssueFromRow(row) : null;
}
