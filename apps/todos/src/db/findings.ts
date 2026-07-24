import type { Database } from "bun:sqlite";
import { redactEvidenceText, redactValue } from "../lib/redaction.js";
import { TaskNotFoundError } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { getTask } from "./tasks.js";
import { getTaskRun, resolveTaskRunId } from "./task-runs.js";

export const TASK_FINDING_SCHEMA_VERSION = "todos.task_finding.v1";
export const TASK_FINDING_UPSERT_SCHEMA_VERSION = "todos.task_finding_upsert.v1";
export const TASK_FINDING_RESOLVE_MISSING_SCHEMA_VERSION = "todos.task_finding_resolve_missing.v1";

export type TaskFindingSeverity = "low" | "medium" | "high" | "critical";
export type TaskFindingStatus = "open" | "resolved" | "ignored";
export type TaskFindingUpsertAction = "preview" | "created" | "matched" | "updated" | "reopened";
export type TaskFindingResolveAction = "preview" | "resolved" | "ignored" | "noop";

export interface TaskFinding {
  schema_version: typeof TASK_FINDING_SCHEMA_VERSION;
  id: string;
  task_id: string;
  run_id: string | null;
  fingerprint: string;
  title: string;
  severity: TaskFindingSeverity;
  status: TaskFindingStatus;
  source: string | null;
  summary: string | null;
  artifact_path: string | null;
  metadata: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompactTaskFinding {
  schema_version: typeof TASK_FINDING_SCHEMA_VERSION;
  id: string;
  task_id: string;
  run_id: string | null;
  fingerprint: string;
  title: string;
  severity: TaskFindingSeverity;
  status: TaskFindingStatus;
  source: string | null;
  summary: string | null;
  artifact_path: string | null;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  metadata_keys: string[];
}

export interface UpsertTaskFindingInput {
  task_id: string;
  fingerprint: string;
  title: string;
  severity?: TaskFindingSeverity | string;
  status?: TaskFindingStatus | string;
  source?: string;
  summary?: string;
  artifact_path?: string;
  run_id?: string;
  metadata?: Record<string, unknown>;
  apply?: boolean;
  observed_at?: string;
}

export interface UpsertTaskFindingResult {
  schema_version: typeof TASK_FINDING_UPSERT_SCHEMA_VERSION;
  local_only: true;
  dry_run: boolean;
  processed_at: string;
  action: TaskFindingUpsertAction;
  fingerprint: string;
  finding: CompactTaskFinding | null;
  warnings: string[];
}

export interface ResolveMissingFindingsInput {
  task_id: string;
  fingerprints: string[];
  source?: string;
  run_id?: string;
  status?: Exclude<TaskFindingStatus, "open"> | string;
  agent_id?: string;
  reason?: string;
  apply?: boolean;
  limit?: number;
  resolved_at?: string;
}

export interface ResolveMissingFindingsResult {
  schema_version: typeof TASK_FINDING_RESOLVE_MISSING_SCHEMA_VERSION;
  local_only: true;
  dry_run: boolean;
  processed_at: string;
  action: TaskFindingResolveAction;
  task_id: string;
  source: string | null;
  run_id: string | null;
  present_fingerprint_count: number;
  candidate_count: number;
  changed_count: number;
  omitted_count: number;
  findings: CompactTaskFinding[];
  warnings: string[];
}

export interface ListTaskFindingsFilter {
  task_id?: string;
  run_id?: string;
  status?: TaskFindingStatus | string;
  source?: string;
  limit?: number;
}

interface TaskFindingRow extends Omit<TaskFinding, "schema_version" | "metadata" | "severity" | "status"> {
  severity: string;
  status: string;
  metadata: string | null;
}

const SEVERITIES = new Set<TaskFindingSeverity>(["low", "medium", "high", "critical"]);
const STATUSES = new Set<TaskFindingStatus>(["open", "resolved", "ignored"]);

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._:/-]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeFingerprint(value: string): string {
  const normalized = normalizeKey(value);
  if (!normalized) throw new Error("finding fingerprint is required");
  return normalized.slice(0, 240);
}

function normalizeSeverity(value: string | undefined): TaskFindingSeverity {
  const normalized = normalizeKey(value || "medium");
  if (SEVERITIES.has(normalized as TaskFindingSeverity)) return normalized as TaskFindingSeverity;
  if (/^(p0|blocker|urgent|highest)$/.test(normalized)) return "critical";
  if (/^(p1|major)$/.test(normalized)) return "high";
  if (/^(p3|minor|info)$/.test(normalized)) return "low";
  return "medium";
}

function normalizeStatus(value: string | undefined): TaskFindingStatus {
  const normalized = normalizeKey(value || "open");
  if (STATUSES.has(normalized as TaskFindingStatus)) return normalized as TaskFindingStatus;
  if (normalized === "closed" || normalized === "fixed") return "resolved";
  return "open";
}

function normalizeResolutionStatus(value: string | undefined): Exclude<TaskFindingStatus, "open"> {
  const status = normalizeStatus(value || "resolved");
  if (status === "open") throw new Error("resolve-missing status must be resolved or ignored");
  return status;
}

function redactOptional(value: string | null | undefined, max = 2000): string | null {
  if (!value) return null;
  const redacted = redactEvidenceText(value).trim();
  if (!redacted) return null;
  return redacted.length > max ? `${redacted.slice(0, max - 3)}...` : redacted;
}

function rowToFinding(row: TaskFindingRow): TaskFinding {
  return {
    schema_version: TASK_FINDING_SCHEMA_VERSION,
    ...row,
    severity: normalizeSeverity(row.severity),
    status: normalizeStatus(row.status),
    metadata: parseObject(row.metadata),
  };
}

function compactFinding(finding: TaskFinding): CompactTaskFinding {
  return {
    schema_version: TASK_FINDING_SCHEMA_VERSION,
    id: finding.id,
    task_id: finding.task_id,
    run_id: finding.run_id,
    fingerprint: finding.fingerprint,
    title: finding.title,
    severity: finding.severity,
    status: finding.status,
    source: finding.source,
    summary: finding.summary,
    artifact_path: finding.artifact_path,
    first_seen_at: finding.first_seen_at,
    last_seen_at: finding.last_seen_at,
    resolved_at: finding.resolved_at,
    metadata_keys: Object.keys(finding.metadata).sort(),
  };
}

function previewFinding(existing: TaskFinding, next: ReturnType<typeof nextFinding>, timestamp: string): TaskFinding {
  return {
    ...existing,
    run_id: next.run_id,
    title: next.title,
    severity: next.severity,
    status: next.status,
    source: next.source,
    summary: next.summary,
    artifact_path: next.artifact_path,
    metadata: next.metadata,
    last_seen_at: timestamp,
    resolved_at: next.status === "open" ? null : existing.resolved_at || timestamp,
    updated_at: timestamp,
  };
}

function upsertAction(existing: TaskFinding, next: ReturnType<typeof nextFinding>): TaskFindingUpsertAction {
  if (sameFinding(existing, next)) return "matched";
  return existing.status !== "open" && next.status === "open" ? "reopened" : "updated";
}

function resolveRunForTask(runId: string | undefined, taskId: string, db: Database): string | null {
  if (!runId) return null;
  const resolved = resolveTaskRunId(runId, db);
  const run = getTaskRun(resolved, db);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.task_id !== taskId) throw new Error(`Run ${resolved} belongs to task ${run.task_id}, not ${taskId}`);
  return resolved;
}

function getFindingByFingerprint(taskId: string, fingerprint: string, db: Database): TaskFinding | null {
  const row = db
    .query("SELECT * FROM task_findings WHERE task_id = ? AND fingerprint = ?")
    .get(taskId, fingerprint) as TaskFindingRow | null;
  return row ? rowToFinding(row) : null;
}

function assertTask(taskId: string, db: Database): void {
  if (!getTask(taskId, db)) throw new TaskNotFoundError(taskId);
}

function nextFinding(input: UpsertTaskFindingInput, db: Database): {
  fingerprint: string;
  run_id: string | null;
  title: string;
  severity: TaskFindingSeverity;
  status: TaskFindingStatus;
  source: string | null;
  summary: string | null;
  artifact_path: string | null;
  metadata: Record<string, unknown>;
} {
  const fingerprint = normalizeFingerprint(input.fingerprint);
  const title = redactOptional(input.title, 300);
  if (!title) throw new Error("finding title is required");
  return {
    fingerprint,
    run_id: resolveRunForTask(input.run_id, input.task_id, db),
    title,
    severity: normalizeSeverity(input.severity),
    status: normalizeStatus(input.status),
    source: redactOptional(input.source, 120),
    summary: redactOptional(input.summary, 2000),
    artifact_path: redactOptional(input.artifact_path, 1000),
    metadata: redactValue(input.metadata || {}),
  };
}

function sameFinding(left: TaskFinding, right: ReturnType<typeof nextFinding>): boolean {
  return left.run_id === right.run_id
    && left.title === right.title
    && left.severity === right.severity
    && left.status === right.status
    && left.source === right.source
    && left.summary === right.summary
    && left.artifact_path === right.artifact_path
    && JSON.stringify(left.metadata) === JSON.stringify(right.metadata);
}

export function upsertTaskFinding(input: UpsertTaskFindingInput, db?: Database): UpsertTaskFindingResult {
  const d = getDatabase(db);
  assertTask(input.task_id, d);
  const timestamp = input.observed_at || now();
  const warnings: string[] = [];
  const next = nextFinding(input, d);
  const existing = getFindingByFingerprint(input.task_id, next.fingerprint, d);
  const dryRun = !input.apply;

  if (dryRun) {
    const action: TaskFindingUpsertAction = existing ? upsertAction(existing, next) : "preview";
    return {
      schema_version: TASK_FINDING_UPSERT_SCHEMA_VERSION,
      local_only: true,
      dry_run: true,
      processed_at: timestamp,
      action,
      fingerprint: next.fingerprint,
      finding: existing ? compactFinding(previewFinding(existing, next, timestamp)) : null,
      warnings,
    };
  }

  if (!existing) {
    const id = uuid();
    d.run(
      `INSERT INTO task_findings (
        id, task_id, run_id, fingerprint, title, severity, status, source, summary, artifact_path,
        metadata, first_seen_at, last_seen_at, resolved_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.task_id,
        next.run_id,
        next.fingerprint,
        next.title,
        next.severity,
        next.status,
        next.source,
        next.summary,
        next.artifact_path,
        JSON.stringify(next.metadata),
        timestamp,
        timestamp,
        next.status === "open" ? null : timestamp,
        timestamp,
        timestamp,
      ],
    );
    return {
      schema_version: TASK_FINDING_UPSERT_SCHEMA_VERSION,
      local_only: true,
      dry_run: false,
      processed_at: timestamp,
      action: "created",
      fingerprint: next.fingerprint,
      finding: compactFinding(getFindingByFingerprint(input.task_id, next.fingerprint, d)!),
      warnings,
    };
  }

  if (sameFinding(existing, next)) {
    return {
      schema_version: TASK_FINDING_UPSERT_SCHEMA_VERSION,
      local_only: true,
      dry_run: false,
      processed_at: timestamp,
      action: "matched",
      fingerprint: next.fingerprint,
      finding: compactFinding(existing),
      warnings,
    };
  }

  const action = upsertAction(existing, next);
  d.run(
    `UPDATE task_findings SET
      run_id = ?, title = ?, severity = ?, status = ?, source = ?, summary = ?, artifact_path = ?,
      metadata = ?, last_seen_at = ?, resolved_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      next.run_id,
      next.title,
      next.severity,
      next.status,
      next.source,
      next.summary,
      next.artifact_path,
      JSON.stringify(next.metadata),
      timestamp,
      next.status === "open" ? null : existing.resolved_at || timestamp,
      timestamp,
      existing.id,
    ],
  );

  return {
    schema_version: TASK_FINDING_UPSERT_SCHEMA_VERSION,
    local_only: true,
    dry_run: false,
    processed_at: timestamp,
    action,
    fingerprint: next.fingerprint,
    finding: compactFinding(getFindingByFingerprint(input.task_id, next.fingerprint, d)!),
    warnings,
  };
}

export function listTaskFindings(filter: ListTaskFindingsFilter = {}, db?: Database): TaskFinding[] {
  const d = getDatabase(db);
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];
  if (filter.task_id) { conditions.push("task_id = ?"); params.push(filter.task_id); }
  if (filter.run_id) { conditions.push("run_id = ?"); params.push(resolveTaskRunId(filter.run_id, d)); }
  if (filter.status) { conditions.push("status = ?"); params.push(normalizeStatus(filter.status)); }
  if (filter.source) { conditions.push("source = ?"); params.push(redactOptional(filter.source, 120)); }
  const limit = Math.min(Math.max(Math.floor(filter.limit ?? 50), 1), 500);
  const rows = d
    .query(`SELECT * FROM task_findings WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC, created_at DESC LIMIT ?`)
    .all(...[...params, limit] as any) as TaskFindingRow[];
  return rows.map(rowToFinding);
}

export function listCompactTaskFindings(filter: ListTaskFindingsFilter = {}, db?: Database): CompactTaskFinding[] {
  return listTaskFindings(filter, db).map(compactFinding);
}

export function resolveMissingTaskFindings(input: ResolveMissingFindingsInput, db?: Database): ResolveMissingFindingsResult {
  const d = getDatabase(db);
  assertTask(input.task_id, d);
  const timestamp = input.resolved_at || now();
  const status = normalizeResolutionStatus(input.status);
  const runId = resolveRunForTask(input.run_id, input.task_id, d);
  const present = new Set(input.fingerprints.map(normalizeFingerprint));
  const warnings: string[] = [];
  const conditions: string[] = ["task_id = ?", "status = 'open'"];
  const params: unknown[] = [input.task_id];
  if (input.source) {
    conditions.push("source = ?");
    params.push(redactOptional(input.source, 120));
  }
  const candidates = (d
    .query(`SELECT * FROM task_findings WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC, created_at DESC`)
    .all(...(params as any)) as TaskFindingRow[])
    .map(rowToFinding)
    .filter((finding) => !present.has(finding.fingerprint));
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 50), 1), 200);
  const display = candidates.slice(0, limit);
  const omittedCount = Math.max(0, candidates.length - display.length);

  if (!input.apply) {
    return {
      schema_version: TASK_FINDING_RESOLVE_MISSING_SCHEMA_VERSION,
      local_only: true,
      dry_run: true,
      processed_at: timestamp,
      action: candidates.length > 0 ? "preview" : "noop",
      task_id: input.task_id,
      source: input.source ? redactOptional(input.source, 120) : null,
      run_id: runId,
      present_fingerprint_count: present.size,
      candidate_count: candidates.length,
      changed_count: 0,
      omitted_count: omittedCount,
      findings: display.map(compactFinding),
      warnings,
    };
  }

  const metadataPatch = redactValue({
    resolved_by: {
      agent_id: input.agent_id ?? null,
      run_id: runId,
      reason: input.reason ? redactEvidenceText(input.reason) : "missing from latest loop finding set",
    },
  });
  const tx = d.transaction(() => {
    for (const finding of candidates) {
      d.run(
        "UPDATE task_findings SET status = ?, resolved_at = ?, metadata = ?, updated_at = ? WHERE id = ? AND status = 'open'",
        [
          status,
          timestamp,
          JSON.stringify({ ...finding.metadata, ...metadataPatch }),
          timestamp,
          finding.id,
        ],
      );
    }
  });
  tx();

  const updated = candidates
    .map((finding) => d.query("SELECT * FROM task_findings WHERE id = ?").get(finding.id) as TaskFindingRow | null)
    .filter((row): row is TaskFindingRow => Boolean(row))
    .map(rowToFinding);
  const visibleUpdated = updated.slice(0, limit);

  return {
    schema_version: TASK_FINDING_RESOLVE_MISSING_SCHEMA_VERSION,
    local_only: true,
    dry_run: false,
    processed_at: timestamp,
    action: updated.length > 0 ? status : "noop",
    task_id: input.task_id,
    source: input.source ? redactOptional(input.source, 120) : null,
    run_id: runId,
    present_fingerprint_count: present.size,
    candidate_count: candidates.length,
    changed_count: updated.length,
    omitted_count: omittedCount,
    findings: visibleUpdated.map(compactFinding),
    warnings,
  };
}
