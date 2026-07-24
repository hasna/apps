import type { Database, SQLQueryBindings } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { getDatabase, now } from "../db/database.js";
import { backupDatabase, checkDatabaseIntegrity, defaultBackupPath, type BackupResult, type IntegrityResult } from "./db-backup.js";
import { listSecretFindings, redactEvidenceText, type SecretFinding } from "./redaction.js";

export const TODOS_EVIDENCE_REDACTION_SCHEMA = "todos.evidence_redaction.v1";
export const TODOS_EVIDENCE_REDACTION_CONFIRM = "REDACT_TODOS_EVIDENCE";

export interface EvidenceRedactionScope {
  task_ids: string[];
  comment_ids: string[];
}

export interface EvidenceRedactionFieldFinding {
  surface: string;
  table: string;
  row_id: string;
  task_id: string | null;
  field: string;
  findings: SecretFinding[];
  would_update: boolean;
  applied: boolean;
}

export interface EvidenceRedactionSurfaceSummary {
  surface: string;
  rows_scanned: number;
  fields_scanned: number;
  matched_fields: number;
  findings: number;
}

export interface EvidenceRedactionBackup {
  path: string;
  bytes: number;
  integrity_ok: boolean;
  quick_check: string;
}

export interface EvidenceRedactionReport {
  schema_version: typeof TODOS_EVIDENCE_REDACTION_SCHEMA;
  generated_at: string;
  dry_run: boolean;
  scope: EvidenceRedactionScope;
  authority_required: boolean;
  authority_present: boolean;
  confirmation_required: typeof TODOS_EVIDENCE_REDACTION_CONFIRM;
  backup: EvidenceRedactionBackup | null;
  surfaces: EvidenceRedactionSurfaceSummary[];
  findings: EvidenceRedactionFieldFinding[];
  totals: {
    rows_scanned: number;
    fields_scanned: number;
    matched_fields: number;
    findings: number;
    would_update_fields: number;
    applied_fields: number;
  };
  redacted_preview: {
    clean: boolean;
    findings: SecretFinding[];
  };
  post_scan: {
    clean: boolean;
    findings: number;
  } | null;
  issues: string[];
}

export interface EvidenceRedactionOptions {
  task_ids?: string[];
  comment_ids?: string[];
  apply?: boolean;
  authority?: string;
  confirm?: string;
  backup_output?: string;
  generated_at?: string;
}

interface TargetField {
  surface: string;
  table: string;
  id_column: string;
  task_id_column?: string;
  fields: string[];
  where: string;
  params: SQLQueryBindings[];
}

interface ScannedRow {
  surface: string;
  table: string;
  row_id: string;
  task_id: string | null;
  values: Record<string, string>;
}

function unique(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

function placeholders(values: string[]): string {
  return values.map(() => "?").join(", ");
}

function tableExists(db: Database, table: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | null;
  return Boolean(row);
}

function tableColumns(db: Database, table: string): Set<string> {
  if (!tableExists(db, table)) return new Set();
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function existingFields(db: Database, table: string, fields: string[]): string[] {
  const columns = tableColumns(db, table);
  return fields.filter((field) => columns.has(field));
}

function normalizeScope(options: EvidenceRedactionOptions): EvidenceRedactionScope {
  return {
    task_ids: unique(options.task_ids),
    comment_ids: unique(options.comment_ids),
  };
}

function scopedCommentTaskIds(db: Database, commentIds: string[]): string[] {
  if (commentIds.length === 0 || !tableExists(db, "task_comments")) return [];
  const rows = db
    .query(`SELECT DISTINCT task_id FROM task_comments WHERE id IN (${placeholders(commentIds)})`)
    .all(...commentIds) as Array<{ task_id: string }>;
  return rows.map((row) => row.task_id).filter(Boolean);
}

function expandScope(db: Database, scope: EvidenceRedactionScope): EvidenceRedactionScope {
  return {
    task_ids: unique([...scope.task_ids, ...scopedCommentTaskIds(db, scope.comment_ids)]),
    comment_ids: scope.comment_ids,
  };
}

function scopedWhere(
  taskIds: string[],
  commentIds: string[],
  taskColumn: string,
  idColumn = "id",
): { where: string; params: SQLQueryBindings[] } | null {
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (taskIds.length > 0) {
    clauses.push(`${taskColumn} IN (${placeholders(taskIds)})`);
    params.push(...taskIds);
  }
  if (commentIds.length > 0) {
    clauses.push(`${idColumn} IN (${placeholders(commentIds)})`);
    params.push(...commentIds);
  }
  if (clauses.length === 0) return null;
  return { where: clauses.join(" OR "), params };
}

function activityWhere(taskIds: string[], commentIds: string[]): { where: string; params: SQLQueryBindings[] } | null {
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (taskIds.length > 0) {
    clauses.push(`(entity_type = 'task' AND entity_id IN (${placeholders(taskIds)}))`);
    params.push(...taskIds);
  }
  if (commentIds.length > 0) {
    clauses.push(`(entity_type = 'comment' AND entity_id IN (${placeholders(commentIds)}))`);
    params.push(...commentIds);
  }
  if (clauses.length === 0) return null;
  return { where: clauses.join(" OR "), params };
}

function buildTargets(db: Database, scope: EvidenceRedactionScope): TargetField[] {
  const targets: TargetField[] = [];
  const taskIds = scope.task_ids;
  const commentIds = scope.comment_ids;

  const add = (target: Omit<TargetField, "fields"> & { fields: string[] }) => {
    const fields = existingFields(db, target.table, target.fields);
    if (fields.length > 0) targets.push({ ...target, fields });
  };

  if (taskIds.length > 0) {
    add({
      surface: "task_metadata",
      table: "tasks",
      id_column: "id",
      task_id_column: "id",
      fields: ["title", "description", "reason", "metadata"],
      where: `id IN (${placeholders(taskIds)})`,
      params: taskIds,
    });

    for (const spec of [
      { surface: "history", table: "task_history", fields: ["old_value", "new_value"], taskColumn: "task_id" },
      { surface: "verification", table: "task_verifications", fields: ["command", "output_summary", "artifact_path"], taskColumn: "task_id" },
      { surface: "portable_verification", table: "verification_records", fields: ["summary", "evidence", "artifact_id"], taskColumn: "task_id" },
      { surface: "runs", table: "task_runs", fields: ["title", "summary", "metadata"], taskColumn: "task_id" },
      { surface: "run_events", table: "task_run_events", fields: ["message", "data"], taskColumn: "task_id" },
      { surface: "run_commands", table: "task_run_commands", fields: ["command", "output_summary", "artifact_path"], taskColumn: "task_id" },
      { surface: "run_artifacts", table: "task_run_artifacts", fields: ["path", "description", "metadata"], taskColumn: "task_id" },
      { surface: "task_files", table: "task_files", fields: ["path", "note"], taskColumn: "task_id" },
      { surface: "commits", table: "task_commits", fields: ["message", "author", "repo_path", "ci_snapshot", "traceability"], taskColumn: "task_id" },
      { surface: "git_refs", table: "task_git_refs", fields: ["name", "url", "metadata"], taskColumn: "task_id" },
    ]) {
      add({
        surface: spec.surface,
        table: spec.table,
        id_column: "id",
        task_id_column: spec.taskColumn,
        fields: spec.fields,
        where: `${spec.taskColumn} IN (${placeholders(taskIds)})`,
        params: taskIds,
      });
    }
  }

  const commentScope = scopedWhere(taskIds, commentIds, "task_id");
  if (commentScope) {
    add({
      surface: "comments",
      table: "task_comments",
      id_column: "id",
      task_id_column: "task_id",
      fields: ["content"],
      where: commentScope.where,
      params: commentScope.params,
    });
  }

  const activityScope = activityWhere(taskIds, commentIds);
  if (activityScope) {
    add({
      surface: "activity",
      table: "activity_log",
      id_column: "id",
      fields: ["old_value", "new_value", "metadata"],
      where: activityScope.where,
      params: activityScope.params,
    });
  }

  return targets;
}

function readRows(db: Database, target: TargetField): ScannedRow[] {
  const taskColumn = target.task_id_column;
  const selected = [
    `${target.id_column} AS __row_id`,
    taskColumn ? `${taskColumn} AS __task_id` : "NULL AS __task_id",
    ...target.fields,
  ];
  const rows = db
    .query(`SELECT ${selected.join(", ")} FROM ${target.table} WHERE ${target.where}`)
    .all(...target.params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    surface: target.surface,
    table: target.table,
    row_id: String(row["__row_id"]),
    task_id: row["__task_id"] ? String(row["__task_id"]) : null,
    values: Object.fromEntries(target.fields.map((field) => [field, row[field] == null ? "" : String(row[field])])),
  }));
}

function surfaceSummaries(rows: ScannedRow[], findings: EvidenceRedactionFieldFinding[]): EvidenceRedactionSurfaceSummary[] {
  const bySurface = new Map<string, EvidenceRedactionSurfaceSummary>();
  for (const row of rows) {
    const current = bySurface.get(row.surface) ?? {
      surface: row.surface,
      rows_scanned: 0,
      fields_scanned: 0,
      matched_fields: 0,
      findings: 0,
    };
    current.rows_scanned += 1;
    current.fields_scanned += Object.keys(row.values).length;
    bySurface.set(row.surface, current);
  }
  for (const finding of findings) {
    const current = bySurface.get(finding.surface);
    if (!current) continue;
    current.matched_fields += 1;
    current.findings += finding.findings.reduce((sum, item) => sum + item.count, 0);
  }
  return Array.from(bySurface.values()).sort((left, right) => left.surface.localeCompare(right.surface));
}

function scanRows(rows: ScannedRow[], applied: boolean): EvidenceRedactionFieldFinding[] {
  const findings: EvidenceRedactionFieldFinding[] = [];
  for (const row of rows) {
    for (const [field, value] of Object.entries(row.values)) {
      if (!value) continue;
      const fieldFindings = listSecretFindings(value);
      if (fieldFindings.length === 0) continue;
      findings.push({
        surface: row.surface,
        table: row.table,
        row_id: row.row_id,
        task_id: row.task_id,
        field,
        findings: fieldFindings,
        would_update: redactEvidenceText(value) !== value,
        applied,
      });
    }
  }
  return findings;
}

function mergeSecretFindings(findings: SecretFinding[]): SecretFinding[] {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    counts.set(finding.pattern, (counts.get(finding.pattern) ?? 0) + finding.count);
  }
  return Array.from(counts.entries())
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((left, right) => left.pattern.localeCompare(right.pattern));
}

function scanRedactedPreview(rows: ScannedRow[]): SecretFinding[] {
  const findings = rows.flatMap((row) => Object.values(row.values)
    .map((value) => redactEvidenceText(value))
    .flatMap((value) => listSecretFindings(value)));
  return mergeSecretFindings(findings);
}

function updateField(db: Database, finding: EvidenceRedactionFieldFinding, rowsByKey: Map<string, ScannedRow>): boolean {
  const row = rowsByKey.get(`${finding.table}:${finding.row_id}`);
  const currentValue = row?.values[finding.field];
  if (currentValue === undefined) return false;
  const redacted = redactEvidenceText(currentValue);
  if (redacted === currentValue) return false;
  db.run(
    `UPDATE ${finding.table} SET ${finding.field} = ? WHERE id = ?`,
    [redacted, finding.row_id],
  );
  return true;
}

function checkedBackup(outputPath: string | undefined): { backup: EvidenceRedactionBackup; raw: BackupResult; integrity: IntegrityResult } {
  const path = outputPath || defaultBackupPath();
  const raw = backupDatabase(path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort: callers still get the backup path and integrity status.
  }
  const integrity = checkDatabaseIntegrity(path);
  return {
    raw,
    integrity,
    backup: {
      path,
      bytes: raw.bytes,
      integrity_ok: integrity.ok,
      quick_check: integrity.quick_check,
    },
  };
}

function assertApplyAuthority(options: EvidenceRedactionOptions): string[] {
  const issues: string[] = [];
  if (!options.authority?.trim()) issues.push("apply requires --authority with an explicit rotation/redaction approval reference");
  if (options.confirm !== TODOS_EVIDENCE_REDACTION_CONFIRM) {
    issues.push(`apply requires --confirm ${TODOS_EVIDENCE_REDACTION_CONFIRM}`);
  }
  return issues;
}

function totals(rows: ScannedRow[], findings: EvidenceRedactionFieldFinding[], appliedFields: number) {
  return {
    rows_scanned: rows.length,
    fields_scanned: rows.reduce((sum, row) => sum + Object.keys(row.values).length, 0),
    matched_fields: findings.length,
    findings: findings.reduce((sum, finding) => sum + finding.findings.reduce((inner, item) => inner + item.count, 0), 0),
    would_update_fields: findings.filter((finding) => finding.would_update).length,
    applied_fields: appliedFields,
  };
}

export function redactEvidenceRows(options: EvidenceRedactionOptions, db?: Database): EvidenceRedactionReport {
  const apply = Boolean(options.apply);
  const initialScope = normalizeScope(options);
  const issues: string[] = [];

  if (initialScope.task_ids.length === 0 && initialScope.comment_ids.length === 0) {
    issues.push("at least one --task or --comment id is required");
  }

  if (apply && db) {
    issues.push("apply requires the default configured database path so a verified SQLite backup can be created first");
  }

  const authorityIssues = apply ? assertApplyAuthority(options) : [];
  issues.push(...authorityIssues);
  if (issues.length > 0) {
    return {
      schema_version: TODOS_EVIDENCE_REDACTION_SCHEMA,
      generated_at: options.generated_at ?? now(),
      dry_run: true,
      scope: initialScope,
      authority_required: true,
      authority_present: Boolean(options.authority?.trim()),
      confirmation_required: TODOS_EVIDENCE_REDACTION_CONFIRM,
      backup: null,
      surfaces: [],
      findings: [],
      totals: totals([], [], 0),
      redacted_preview: { clean: true, findings: [] },
      post_scan: null,
      issues,
    };
  }

  let backup: EvidenceRedactionBackup | null = null;
  if (apply) {
    const result = checkedBackup(options.backup_output);
    backup = result.backup;
    if (!result.integrity.ok) {
      issues.push(`backup integrity failed: ${result.integrity.errors.join("; ")}`);
    }
  }

  const d = db || getDatabase();
  const scope = expandScope(d, initialScope);
  const targets = buildTargets(d, scope);
  const rows = targets.flatMap((target) => readRows(d, target));
  const beforeFindings = scanRows(rows, false);
  const previewFindings = scanRedactedPreview(rows);
  let appliedFields = 0;
  let postScan: EvidenceRedactionReport["post_scan"] = null;
  let finalFindings = beforeFindings;

  if (apply && issues.length === 0 && beforeFindings.length > 0) {
    const rowsByKey = new Map(rows.map((row) => [`${row.table}:${row.row_id}`, row]));
    const tx = d.transaction(() => {
      for (const finding of beforeFindings) {
        if (updateField(d, finding, rowsByKey)) appliedFields += 1;
      }
    });
    tx();
    const afterRows = targets.flatMap((target) => readRows(d, target));
    finalFindings = scanRows(afterRows, true);
    postScan = {
      clean: finalFindings.length === 0,
      findings: finalFindings.reduce((sum, finding) => sum + finding.findings.reduce((inner, item) => inner + item.count, 0), 0),
    };
  } else if (apply) {
    postScan = {
      clean: beforeFindings.length === 0,
      findings: beforeFindings.reduce((sum, finding) => sum + finding.findings.reduce((inner, item) => inner + item.count, 0), 0),
    };
  }

  return {
    schema_version: TODOS_EVIDENCE_REDACTION_SCHEMA,
    generated_at: options.generated_at ?? now(),
    dry_run: !apply || issues.length > 0,
    scope,
    authority_required: true,
    authority_present: Boolean(options.authority?.trim()),
    confirmation_required: TODOS_EVIDENCE_REDACTION_CONFIRM,
    backup,
    surfaces: surfaceSummaries(rows, beforeFindings),
    findings: apply ? finalFindings : beforeFindings,
    totals: totals(rows, beforeFindings, appliedFields),
    redacted_preview: {
      clean: previewFindings.length === 0,
      findings: previewFindings,
    },
    post_scan: postScan,
    issues,
  };
}

export function defaultEvidenceRedactionBackupPath(dbPath?: string): string {
  const base = defaultBackupPath(dbPath);
  return join(base.replace(/\.db$/, ""), "pre-redaction.db");
}
