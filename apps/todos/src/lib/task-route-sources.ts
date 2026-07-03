import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Task, TaskRow } from "../types/index.js";
import { isLockExpired } from "../db/database.js";
import { getBlockingDeps } from "../db/task-lifecycle.js";
import { rowToTask } from "../db/task-crud.js";
import { redactValue } from "./redaction.js";
import { getTaskRouteState, type TaskRouteState } from "./task-routing.js";

export const TASK_ROUTE_SOURCE_DISCOVERY_SCHEMA_VERSION = "todos.task_route_sources.v1";

export interface DiscoverTaskRouteSourcesInput {
  sourceRoots?: string[];
  sourceStores?: string[];
  include?: string[];
  exclude?: string[];
  limit?: number;
}

export type TaskRouteSourceStoreStatus = "ok" | "missing" | "error";

export interface TaskRouteSourceError {
  source_store_id: string;
  source_repo_path: string | null;
  source_db_path: string;
  code: "STORE_MISSING" | "STORE_UNREADABLE" | "STORE_INVALID" | "SOURCE_ROOT_MISSING" | "SOURCE_ROOT_UNREADABLE";
  message: string;
}

export interface TaskRouteSourceStoreResult {
  source_store_id: string;
  source_repo_path: string | null;
  source_db_path: string;
  status: TaskRouteSourceStoreStatus;
  /** Total ready candidates found in this store before result-level limit truncation. */
  candidate_count: number;
  /** Candidates returned from this store after result-level limit truncation. */
  returned_candidate_count: number;
  errors: TaskRouteSourceError[];
}

export interface TaskRouteSourceCandidate {
  source_store_id: string;
  source_repo_path: string | null;
  source_db_path: string;
  source_task_key: string;
  /** True when the store was selected by explicit sourceRoots/sourceStores and include/exclude inputs. Not dispatch authorization. */
  source_selected_by_input: boolean;
  task_id: string;
  task_short_id: string | null;
  title: string;
  status: Task["status"];
  priority: Task["priority"];
  project_path: string | null;
  task_version: number;
  task_updated_at: string;
  task_fingerprint: string | null;
  tags: string[];
  task_intent: {
    auto_route: boolean;
  };
  metadata: Record<string, unknown>;
  route_state: TaskRouteState;
}

export interface TaskRouteSourceDiscoveryResult {
  schema_version: typeof TASK_ROUTE_SOURCE_DISCOVERY_SCHEMA_VERSION;
  sourceRoots: string[];
  sourceStores: string[];
  include: string[];
  exclude: string[];
  limit: number | null;
  total_candidate_count: number;
  returned_candidate_count: number;
  truncated: boolean;
  stores: TaskRouteSourceStoreResult[];
  candidates: TaskRouteSourceCandidate[];
  errors: TaskRouteSourceError[];
}

interface SourceStoreRef {
  source_store_id: string;
  source_repo_path: string | null;
  source_db_path: string;
}

const TODO_STORE_RELATIVE_PATH = join(".hasna", "todos", "todos.db");
const ROOT_SCAN_MAX_DEPTH = 5;
const SKIPPED_SCAN_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
]);

function normalizePath(input: string): string {
  return resolve(input);
}

function sourceStoreId(sourceDbPath: string): string {
  const digest = createHash("sha256").update(sourceDbPath).digest("hex").slice(0, 16);
  return `sqlite:${digest}`;
}

function inferSourceRepoPath(sourceDbPath: string): string | null {
  const normalized = normalizePath(sourceDbPath);
  if (normalized.endsWith(TODO_STORE_RELATIVE_PATH)) {
    return dirname(dirname(dirname(normalized)));
  }
  return dirname(normalized);
}

function createStoreRef(sourceDbPath: string): SourceStoreRef {
  const normalized = normalizePath(sourceDbPath);
  return {
    source_store_id: sourceStoreId(normalized),
    source_repo_path: inferSourceRepoPath(normalized),
    source_db_path: normalized,
  };
}

function normalizePatterns(patterns: string[] | undefined): string[] {
  return (patterns ?? []).map((pattern) => pattern.trim()).filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globPatternToRegExp(pattern: string): RegExp {
  let source = "";
  for (const char of pattern) {
    if (char === "*") source += ".*";
    else if (char === "?") source += ".";
    else source += escapeRegExp(char);
  }
  return new RegExp(`^${source}$`);
}

function matchesPattern(value: string, pattern: string): boolean {
  const normalizedValue = value.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");
  if (normalizedPattern.includes("*") || normalizedPattern.includes("?")) {
    return globPatternToRegExp(normalizedPattern).test(normalizedValue);
  }
  return normalizedValue.includes(normalizedPattern);
}

function storeMatchesAny(ref: SourceStoreRef, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const paths = [ref.source_db_path, ref.source_repo_path].filter((value): value is string => Boolean(value));
  const values = paths.flatMap((value) => [value, basename(value)]);
  return patterns.some((pattern) => values.some((value) => matchesPattern(value, pattern)));
}

function shouldIncludeStore(ref: SourceStoreRef, include: string[], exclude: string[]): boolean {
  const included = include.length === 0 || storeMatchesAny(ref, include);
  return included && !storeMatchesAny(ref, exclude);
}

function discoverStoresUnderRoot(sourceRoot: string): { stores: SourceStoreRef[]; errors: TaskRouteSourceError[] } {
  const rootPath = normalizePath(sourceRoot);
  const errors: TaskRouteSourceError[] = [];
  const stores: SourceStoreRef[] = [];

  if (!existsSync(rootPath)) {
    const ref = createStoreRef(join(rootPath, TODO_STORE_RELATIVE_PATH));
    errors.push({
      ...ref,
      code: "SOURCE_ROOT_MISSING",
      message: `Source root does not exist: ${rootPath}`,
    });
    return { stores, errors };
  }

  let rootStat;
  try {
    rootStat = statSync(rootPath);
  } catch (error) {
    const ref = createStoreRef(join(rootPath, TODO_STORE_RELATIVE_PATH));
    errors.push({
      ...ref,
      code: "SOURCE_ROOT_UNREADABLE",
      message: error instanceof Error ? error.message : `Unable to read source root: ${rootPath}`,
    });
    return { stores, errors };
  }

  if (rootStat.isFile()) {
    stores.push(createStoreRef(rootPath));
    return { stores, errors };
  }

  function scanDirectory(dir: string, depth: number): void {
    const candidate = join(dir, TODO_STORE_RELATIVE_PATH);
    if (existsSync(candidate)) {
      stores.push(createStoreRef(candidate));
    }
    if (depth >= ROOT_SCAN_MAX_DEPTH) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      const ref = createStoreRef(candidate);
      errors.push({
        ...ref,
        code: "SOURCE_ROOT_UNREADABLE",
        message: error instanceof Error ? error.message : `Unable to read source root: ${dir}`,
      });
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIPPED_SCAN_DIRS.has(entry.name)) continue;
      scanDirectory(join(dir, entry.name), depth + 1);
    }
  }

  scanDirectory(rootPath, 0);
  return { stores, errors };
}

function collectStoreRefs(input: DiscoverTaskRouteSourcesInput): { stores: SourceStoreRef[]; errors: TaskRouteSourceError[] } {
  const byPath = new Map<string, SourceStoreRef>();
  const errors: TaskRouteSourceError[] = [];

  for (const storePath of input.sourceStores ?? []) {
    const ref = createStoreRef(storePath);
    byPath.set(ref.source_db_path, ref);
  }

  for (const sourceRoot of input.sourceRoots ?? []) {
    const discovered = discoverStoresUnderRoot(sourceRoot);
    for (const ref of discovered.stores) {
      byPath.set(ref.source_db_path, ref);
    }
    errors.push(...discovered.errors);
  }

  return {
    stores: [...byPath.values()].sort((a, b) => a.source_db_path.localeCompare(b.source_db_path)),
    errors: errors.sort((a, b) => a.source_db_path.localeCompare(b.source_db_path)),
  };
}

function openReadonlyStore(ref: SourceStoreRef): Database {
  if (!existsSync(ref.source_db_path)) {
    throw Object.assign(new Error(`Store does not exist: ${ref.source_db_path}`), { code: "STORE_MISSING" });
  }
  return new Database(ref.source_db_path, { readonly: true, create: false });
}

function hasTable(db: Database, tableName: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | null;
  return Boolean(row);
}

function tableColumns(db: Database, tableName: string): Set<string> {
  const rows = db.query(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function listPendingTasksReadonly(db: Database): Task[] {
  if (!hasTable(db, "tasks")) {
    throw Object.assign(new Error("Store does not contain a tasks table"), { code: "STORE_INVALID" });
  }
  const columns = tableColumns(db, "tasks");
  const conditions = ["status = 'pending'"];
  if (columns.has("archived_at")) conditions.push("archived_at IS NULL");
  const rows = db
    .query(
      `SELECT * FROM tasks WHERE ${conditions.join(" AND ")}
       ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at DESC`,
    )
    .all() as TaskRow[];
  return rows.map(rowToTask);
}

function isReadyTask(task: Task, db: Database): boolean {
  if (task.locked_by && !isLockExpired(task.locked_at)) return false;
  return getBlockingDeps(task.id, db).length === 0;
}

function metadataFingerprint(metadata: Record<string, unknown>): string | null {
  const value = metadata.fingerprint;
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function boundedMetadataValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") {
    return value.length > 2000 ? `${value.slice(0, 2000)}[TRUNCATED]` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => boundedMetadataValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
      const normalized = key.toLowerCase();
      if (normalized === "comment" || normalized === "comments" || normalized === "task_comments") {
        result[key] = "[REDACTED_COMMENT]";
        continue;
      }
      result[key] = boundedMetadataValue(child, depth + 1);
    }
    return result;
  }
  return value;
}

function discoveryMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redactValue(boundedMetadataValue(metadata)) as Record<string, unknown>;
}

function sourceCandidate(ref: SourceStoreRef, task: Task, db: Database): TaskRouteSourceCandidate {
  const routeState = getTaskRouteState(task, db);
  const autoRoute = task.tags.includes("auto:route") || task.tags.includes("route:enabled");
  return {
    source_store_id: ref.source_store_id,
    source_repo_path: ref.source_repo_path,
    source_db_path: ref.source_db_path,
    source_task_key: `${ref.source_store_id}:${task.id}`,
    source_selected_by_input: true,
    task_id: task.id,
    task_short_id: task.short_id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    project_path: routeState.route.project_path ?? task.working_dir ?? ref.source_repo_path,
    task_version: task.version,
    task_updated_at: task.updated_at,
    task_fingerprint: metadataFingerprint(task.metadata),
    tags: task.tags,
    task_intent: {
      auto_route: autoRoute,
    },
    metadata: discoveryMetadata(task.metadata),
    route_state: routeState,
  };
}

function discoveryError(ref: SourceStoreRef, code: TaskRouteSourceError["code"], error: unknown): TaskRouteSourceError {
  return {
    ...ref,
    code,
    message: error instanceof Error ? error.message : String(error),
  };
}

function errorCode(error: unknown): TaskRouteSourceError["code"] {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "STORE_MISSING") {
    return "STORE_MISSING";
  }
  if (typeof error === "object" && error !== null && "code" in error && error.code === "STORE_INVALID") {
    return "STORE_INVALID";
  }
  return "STORE_UNREADABLE";
}

export function discoverTaskRouteSources(input: DiscoverTaskRouteSourcesInput): TaskRouteSourceDiscoveryResult {
  const include = normalizePatterns(input.include);
  const exclude = normalizePatterns(input.exclude);
  const sourceRoots = (input.sourceRoots ?? []).map(normalizePath).sort();
  const sourceStores = (input.sourceStores ?? []).map(normalizePath).sort();
  const limit = Number.isFinite(input.limit ?? NaN) && (input.limit ?? 0) >= 0 ? Math.floor(input.limit ?? 0) : null;
  const collected = collectStoreRefs(input);
  const stores: TaskRouteSourceStoreResult[] = [];
  const errors: TaskRouteSourceError[] = [...collected.errors];
  const candidates: TaskRouteSourceCandidate[] = [];
  let totalCandidateCount = 0;

  for (const ref of collected.stores) {
    if (!shouldIncludeStore(ref, include, exclude)) continue;

    const storeErrors: TaskRouteSourceError[] = [];
    let db: Database | null = null;
    try {
      db = openReadonlyStore(ref);
      const readyTasks = listPendingTasksReadonly(db).filter((task) => isReadyTask(task, db!));
      totalCandidateCount += readyTasks.length;
      const remaining = limit === null ? readyTasks.length : Math.max(0, limit - candidates.length);
      const selectedTasks = limit === null ? readyTasks : readyTasks.slice(0, remaining);
      candidates.push(...selectedTasks.map((task) => sourceCandidate(ref, task, db!)));
      stores.push({
        ...ref,
        status: "ok",
        candidate_count: readyTasks.length,
        returned_candidate_count: selectedTasks.length,
        errors: [],
      });
    } catch (error) {
      const storeError = discoveryError(ref, errorCode(error), error);
      storeErrors.push(storeError);
      errors.push(storeError);
      stores.push({
        ...ref,
        status: storeError.code === "STORE_MISSING" ? "missing" : "error",
        candidate_count: 0,
        returned_candidate_count: 0,
        errors: storeErrors,
      });
    } finally {
      db?.close();
    }
  }

  return {
    schema_version: TASK_ROUTE_SOURCE_DISCOVERY_SCHEMA_VERSION,
    sourceRoots,
    sourceStores,
    include,
    exclude,
    limit,
    total_candidate_count: totalCandidateCount,
    returned_candidate_count: candidates.length,
    truncated: limit !== null && totalCandidateCount > candidates.length,
    stores,
    candidates,
    errors,
  };
}
