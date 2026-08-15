import type { Database, SQLQueryBindings } from "bun:sqlite";
import { existsSync, unlinkSync } from "node:fs";
import { artifactStorePath } from "./artifact-store.js";
import { getDatabase } from "../db/database.js";
import type { TaskStatus } from "../types/index.js";

export const RETENTION_CLEANUP_CONFIRMATION = "delete-local-retention-data";

export type RetentionCleanupScope = "comments" | "runs" | "verifications" | "expired_artifacts";
export type RetentionCleanupRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface RetentionCleanupInput {
  older_than_days: number;
  project_id?: string;
  task_statuses?: TaskStatus[];
  run_statuses?: RetentionCleanupRunStatus[];
  include?: RetentionCleanupScope[];
  now?: string;
}

export interface ApplyRetentionCleanupInput extends RetentionCleanupInput {
  confirm?: string;
}

export interface RetentionCleanupRecordCandidate {
  id: string;
  task_id: string;
  project_id: string | null;
  task_status: string;
  created_at: string;
  status?: string;
}

export interface RetentionCleanupArtifactFileCandidate {
  relative_path: string;
  artifact_ids: string[];
  expires_at: string;
  size_bytes: number | null;
}

export interface RetentionCleanupCounts {
  comments: number;
  runs: number;
  verifications: number;
  artifact_files: number;
}

export interface RetentionCleanupReport {
  schema_version: 1;
  local_only: true;
  dry_run: boolean;
  generated_at: string;
  cutoff_at: string;
  confirmation_required: typeof RETENTION_CLEANUP_CONFIRMATION;
  filters: {
    older_than_days: number;
    project_id: string | null;
    task_statuses: string[];
    run_statuses: string[];
    include: RetentionCleanupScope[];
  };
  candidate_counts: RetentionCleanupCounts;
  deleted_counts: RetentionCleanupCounts;
  candidates: {
    comments: RetentionCleanupRecordCandidate[];
    runs: RetentionCleanupRecordCandidate[];
    verifications: RetentionCleanupRecordCandidate[];
    artifact_files: RetentionCleanupArtifactFileCandidate[];
  };
  warnings: string[];
}

interface SqlFilter {
  where: string[];
  args: SQLQueryBindings[];
}

interface ArtifactStoreMetadata {
  stored?: boolean;
  relative_path?: string;
  size_bytes?: number;
  retention?: {
    expires_at?: string | null;
  };
}

interface ArtifactRow {
  id: string;
  run_id: string;
  task_id: string;
  project_id: string | null;
  task_status: string;
  metadata: string | null;
}

const ALL_SCOPES: RetentionCleanupScope[] = ["comments", "runs", "verifications", "expired_artifacts"];
const EMPTY_COUNTS: RetentionCleanupCounts = {
  comments: 0,
  runs: 0,
  verifications: 0,
  artifact_files: 0,
};

function normalizeScopes(scopes: RetentionCleanupScope[] | undefined): RetentionCleanupScope[] {
  if (!scopes || scopes.length === 0) return [...ALL_SCOPES];
  return Array.from(new Set(scopes));
}

function assertValidInput(input: RetentionCleanupInput): void {
  if (!Number.isInteger(input.older_than_days) || input.older_than_days <= 0) {
    throw new Error("older_than_days must be a positive integer");
  }
  const unknown = normalizeScopes(input.include).filter((scope) => !ALL_SCOPES.includes(scope));
  if (unknown.length > 0) throw new Error(`Unknown retention cleanup scope: ${unknown.join(", ")}`);
}

function cutoffFor(input: RetentionCleanupInput, generatedAt: string): string {
  const millis = Date.parse(generatedAt) - input.older_than_days * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(millis)) throw new Error("now must be an ISO timestamp");
  return new Date(millis).toISOString();
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}

function taskFilters(input: RetentionCleanupInput): SqlFilter {
  const where: string[] = [];
  const args: SQLQueryBindings[] = [];
  if (input.project_id) {
    where.push("t.project_id = ?");
    args.push(input.project_id);
  }
  if (input.task_statuses && input.task_statuses.length > 0) {
    where.push(`t.status IN (${placeholders(input.task_statuses)})`);
    args.push(...input.task_statuses);
  }
  return { where, args };
}

function whereSql(base: string[], filter: SqlFilter): { sql: string; args: SQLQueryBindings[] } {
  const where = [...base, ...filter.where];
  return { sql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "", args: [...filter.args] };
}

function parseArtifactStore(metadata: string | null): ArtifactStoreMetadata | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    const store = parsed["artifact_store"];
    if (!store || typeof store !== "object" || Array.isArray(store)) return null;
    return store as ArtifactStoreMetadata;
  } catch {
    return null;
  }
}

function getCommentCandidates(input: RetentionCleanupInput, cutoffAt: string, db: Database): RetentionCleanupRecordCandidate[] {
  const filter = taskFilters(input);
  const { sql, args } = whereSql(["c.created_at < ?"], filter);
  return db.query(`
    SELECT c.id, c.task_id, t.project_id, t.status AS task_status, c.created_at
    FROM task_comments c
    JOIN tasks t ON t.id = c.task_id
    ${sql}
    ORDER BY c.created_at, c.id
  `).all(cutoffAt, ...args) as RetentionCleanupRecordCandidate[];
}

function getRunCandidates(input: RetentionCleanupInput, cutoffAt: string, db: Database): RetentionCleanupRecordCandidate[] {
  const filter = taskFilters(input);
  const where = ["COALESCE(r.completed_at, r.updated_at, r.started_at, r.created_at) < ?"];
  const args: SQLQueryBindings[] = [cutoffAt];
  if (input.run_statuses && input.run_statuses.length > 0) {
    where.push(`r.status IN (${placeholders(input.run_statuses)})`);
    args.push(...input.run_statuses);
  }
  const combined = whereSql(where, filter);
  return db.query(`
    SELECT r.id, r.task_id, t.project_id, t.status AS task_status,
      COALESCE(r.completed_at, r.updated_at, r.started_at, r.created_at) AS created_at,
      r.status
    FROM task_runs r
    JOIN tasks t ON t.id = r.task_id
    ${combined.sql}
    ORDER BY created_at, r.id
  `).all(...args, ...filter.args) as RetentionCleanupRecordCandidate[];
}

function getVerificationCandidates(input: RetentionCleanupInput, cutoffAt: string, db: Database): RetentionCleanupRecordCandidate[] {
  const filter = taskFilters(input);
  const { sql, args } = whereSql(["COALESCE(v.run_at, v.created_at) < ?"], filter);
  return db.query(`
    SELECT v.id, v.task_id, t.project_id, t.status AS task_status,
      COALESCE(v.run_at, v.created_at) AS created_at,
      v.status
    FROM task_verifications v
    JOIN tasks t ON t.id = v.task_id
    ${sql}
    ORDER BY created_at, v.id
  `).all(cutoffAt, ...args) as RetentionCleanupRecordCandidate[];
}

function getArtifactRows(input: RetentionCleanupInput, db: Database): ArtifactRow[] {
  const filter = taskFilters(input);
  const { sql, args } = whereSql([], filter);
  return db.query(`
    SELECT a.id, a.run_id, a.task_id, t.project_id, t.status AS task_status, a.metadata
    FROM task_run_artifacts a
    JOIN tasks t ON t.id = a.task_id
    ${sql}
    ORDER BY a.created_at, a.id
  `).all(...args) as ArtifactRow[];
}

function getExpiredArtifactFileCandidates(
  input: RetentionCleanupInput,
  generatedAt: string,
  db: Database,
  deletedRunIds: Set<string>,
): RetentionCleanupArtifactFileCandidate[] {
  const rows = getArtifactRows(input, db);
  const byPath = new Map<string, Array<{ row: ArtifactRow; store: ArtifactStoreMetadata; expires_at: string | null }>>();

  for (const row of rows) {
    const store = parseArtifactStore(row.metadata);
    const expiresAt = store?.retention?.expires_at;
    if (store?.stored !== true || typeof store.relative_path !== "string") continue;
    const entries = byPath.get(store.relative_path) || [];
    entries.push({ row, store, expires_at: expiresAt ?? null });
    byPath.set(store.relative_path, entries);
  }

  const candidates: RetentionCleanupArtifactFileCandidate[] = [];
  for (const [relativePath, entries] of byPath) {
    const retainedEntries = entries.filter((entry) => (
      !deletedRunIds.has(entry.row.run_id)
      && (!entry.expires_at || entry.expires_at > generatedAt)
    ));
    if (retainedEntries.length > 0) continue;
    const removableEntries = entries.filter((entry) => (
      deletedRunIds.has(entry.row.run_id)
      || Boolean(entry.expires_at && entry.expires_at <= generatedAt)
    ));
    if (removableEntries.length === 0) continue;
    const latestExpiry = removableEntries
      .map((entry) => entry.expires_at)
      .filter((expiresAt): expiresAt is string => typeof expiresAt === "string")
      .sort()
      .at(-1) ?? generatedAt;
    candidates.push({
      relative_path: relativePath,
      artifact_ids: removableEntries.map((entry) => entry.row.id).sort(),
      expires_at: latestExpiry,
      size_bytes: typeof removableEntries[0]!.store.size_bytes === "number" ? removableEntries[0]!.store.size_bytes! : null,
    });
  }
  return candidates.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
}

function buildReport(input: RetentionCleanupInput, dryRun: boolean, db: Database): RetentionCleanupReport {
  assertValidInput(input);
  const generatedAt = input.now || new Date().toISOString();
  const cutoffAt = cutoffFor(input, generatedAt);
  const include = normalizeScopes(input.include);
  const comments = include.includes("comments") ? getCommentCandidates(input, cutoffAt, db) : [];
  const runs = include.includes("runs") ? getRunCandidates(input, cutoffAt, db) : [];
  const verifications = include.includes("verifications") ? getVerificationCandidates(input, cutoffAt, db) : [];
  const deletedRunIds = new Set(runs.map((run) => run.id));
  const artifactFiles = include.includes("expired_artifacts")
    ? getExpiredArtifactFileCandidates(input, generatedAt, db, deletedRunIds)
    : [];

  return {
    schema_version: 1,
    local_only: true,
    dry_run: dryRun,
    generated_at: generatedAt,
    cutoff_at: cutoffAt,
    confirmation_required: RETENTION_CLEANUP_CONFIRMATION,
    filters: {
      older_than_days: input.older_than_days,
      project_id: input.project_id ?? null,
      task_statuses: input.task_statuses ?? [],
      run_statuses: input.run_statuses ?? [],
      include,
    },
    candidate_counts: {
      comments: comments.length,
      runs: runs.length,
      verifications: verifications.length,
      artifact_files: artifactFiles.length,
    },
    deleted_counts: { ...EMPTY_COUNTS },
    candidates: {
      comments,
      runs,
      verifications,
      artifact_files: artifactFiles,
    },
    warnings: [],
  };
}

function deleteByIds(db: Database, table: string, ids: string[]): number {
  if (ids.length === 0) return 0;
  const bindings = ids as SQLQueryBindings[];
  const before = db
    .query(`SELECT COUNT(*) AS count FROM ${table} WHERE id IN (${placeholders(ids)})`)
    .get(...bindings) as { count: number };
  db.run(`DELETE FROM ${table} WHERE id IN (${placeholders(ids)})`, bindings);
  return before.count;
}

export function previewRetentionCleanup(input: RetentionCleanupInput, db?: Database): RetentionCleanupReport {
  return buildReport(input, true, db || getDatabase());
}

export function applyRetentionCleanup(input: ApplyRetentionCleanupInput, db?: Database): RetentionCleanupReport {
  if (input.confirm !== RETENTION_CLEANUP_CONFIRMATION) {
    throw new Error(`Destructive cleanup requires --confirm ${RETENTION_CLEANUP_CONFIRMATION}`);
  }
  const d = db || getDatabase();
  const report = buildReport(input, false, d);
  const deleteInTransaction = d.transaction(() => {
    report.deleted_counts.comments = deleteByIds(d, "task_comments", report.candidates.comments.map((item) => item.id));
    report.deleted_counts.verifications = deleteByIds(d, "task_verifications", report.candidates.verifications.map((item) => item.id));
    report.deleted_counts.runs = deleteByIds(d, "task_runs", report.candidates.runs.map((item) => item.id));
  });
  deleteInTransaction();

  for (const artifact of report.candidates.artifact_files) {
    try {
      const path = artifactStorePath(artifact.relative_path);
      if (!existsSync(path)) {
        report.warnings.push(`stored artifact already missing: ${artifact.relative_path}`);
        continue;
      }
      unlinkSync(path);
      report.deleted_counts.artifact_files += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.warnings.push(`could not delete stored artifact ${artifact.relative_path}: ${message}`);
    }
  }
  return report;
}
