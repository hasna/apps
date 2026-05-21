import type { Database, SQLQueryBindings } from "bun:sqlite";
import { getPackageVersion } from "./package-version.js";
import { getDatabase, now } from "../db/database.js";
import { getTask, updateTask } from "../db/tasks.js";
import { exportStoredArtifactContent, importStoredArtifactContent, type ExportedArtifactContent } from "./artifact-store.js";
import type { Project, Plan, Task, TaskBoard, TaskComment, TaskDependency, TaskList } from "../types/index.js";
import type { TaskCommit, TaskGitRef, TaskVerification } from "../db/task-commits.js";
import type { TaskFile } from "../db/task-files.js";
import type { TaskRun, TaskRunArtifact, TaskRunCommand, TaskRunEvent } from "../db/task-runs.js";
import type { SavedSearchView } from "./saved-search-views.js";
import { appendSyncConflict } from "./sync-utils.js";
import { redactValue } from "./redaction.js";

export const TODOS_LOCAL_BRIDGE_KIND = "hasna.todos.local-bridge";
export const TODOS_LOCAL_BRIDGE_SCHEMA_VERSION = 1;

export interface TodosLocalBridgePackageSource {
  packageName: "@hasna/todos";
  repository: "hasna/todos";
  version: string;
}

export interface TodosLocalBridgeSource {
  project_id: string | null;
  project_path: string | null;
}

export interface TodosLocalBridgeData {
  projects: Project[];
  task_lists: TaskList[];
  plans: Plan[];
  tasks: Task[];
  task_dependencies: TaskDependency[];
  comments: TaskComment[];
  runs: TaskRun[];
  run_events: TaskRunEvent[];
  run_commands: TaskRunCommand[];
  run_artifacts: TaskRunArtifact[];
  task_files: TaskFile[];
  task_commits: TaskCommit[];
  task_git_refs: TaskGitRef[];
  task_verifications: TaskVerification[];
  saved_views: SavedSearchView[];
  task_boards: TaskBoard[];
}

export interface TodosLocalBridgeBundle {
  schemaVersion: typeof TODOS_LOCAL_BRIDGE_SCHEMA_VERSION;
  kind: typeof TODOS_LOCAL_BRIDGE_KIND;
  exportedAt: string;
  package: TodosLocalBridgePackageSource;
  source: TodosLocalBridgeSource;
  data: TodosLocalBridgeData;
  artifact_contents?: ExportedArtifactContent[];
  stats: Record<keyof TodosLocalBridgeData, number>;
}

export interface ExportLocalBridgeOptions {
  project_id?: string;
  generatedAt?: string;
  version?: string;
}

export interface LocalBridgeValidationResult {
  ok: boolean;
  issues: string[];
}

export interface LocalBridgeImportConflict {
  table: string;
  id: string;
  reason: "already_exists" | "missing_dependency" | "diverged";
  fields?: string[];
  resolution?: "skipped" | "safe_merged" | "manual_required";
}

export interface LocalBridgeImportResult {
  ok: boolean;
  dry_run: boolean;
  inserted: Record<keyof TodosLocalBridgeData, number>;
  merged: Record<keyof TodosLocalBridgeData, number>;
  skipped: Record<keyof TodosLocalBridgeData, number>;
  conflicts: LocalBridgeImportConflict[];
  issues: string[];
}

export type LocalBridgeConflictStrategy = "skip" | "safe_merge";

export interface ImportLocalBridgeOptions {
  dryRun?: boolean;
  conflictStrategy?: LocalBridgeConflictStrategy;
}

const dataKeys = [
  "projects",
  "task_lists",
  "plans",
  "tasks",
  "task_dependencies",
  "comments",
  "runs",
  "run_events",
  "run_commands",
  "run_artifacts",
  "task_files",
  "task_commits",
  "task_git_refs",
  "task_verifications",
  "saved_views",
  "task_boards",
] as const satisfies readonly (keyof TodosLocalBridgeData)[];

const insertColumns: Record<keyof TodosLocalBridgeData, readonly string[]> = {
  projects: ["id", "name", "path", "description", "task_list_id", "task_prefix", "task_counter", "created_at", "updated_at", "machine_id", "synced_at"],
  task_lists: ["id", "project_id", "slug", "name", "description", "metadata", "created_at", "updated_at", "machine_id", "synced_at"],
  plans: ["id", "project_id", "task_list_id", "agent_id", "name", "description", "status", "created_at", "updated_at", "machine_id", "synced_at"],
  tasks: [
    "id", "short_id", "project_id", "parent_id", "plan_id", "task_list_id", "title", "description", "status", "priority",
    "agent_id", "assigned_to", "session_id", "working_dir", "tags", "metadata", "version", "locked_by", "locked_at",
    "created_at", "updated_at", "started_at", "completed_at", "due_at", "estimated_minutes", "actual_minutes",
    "requires_approval", "approved_by", "approved_at", "recurrence_rule", "recurrence_parent_id", "spawns_template_id",
    "confidence", "reason", "spawned_from_session", "assigned_by", "assigned_from_project", "task_type", "cost_tokens",
    "cost_usd", "delegated_from", "delegation_depth", "retry_count", "max_retries", "retry_after", "sla_minutes",
    "runner_id", "runner_started_at", "runner_completed_at", "current_step", "total_steps", "cycle_id", "machine_id",
    "synced_at", "archived_at",
  ],
  task_dependencies: ["task_id", "depends_on", "external_project_id", "external_task_id"],
  comments: ["id", "task_id", "agent_id", "session_id", "content", "type", "progress_pct", "created_at", "machine_id", "synced_at"],
  runs: ["id", "task_id", "agent_id", "title", "status", "summary", "metadata", "started_at", "completed_at", "created_at", "updated_at"],
  run_events: ["id", "run_id", "task_id", "event_type", "message", "data", "agent_id", "created_at"],
  run_commands: ["id", "run_id", "task_id", "command", "status", "exit_code", "output_summary", "artifact_path", "agent_id", "started_at", "completed_at", "created_at"],
  run_artifacts: ["id", "run_id", "task_id", "path", "artifact_type", "description", "size_bytes", "sha256", "metadata", "agent_id", "created_at"],
  task_files: ["id", "task_id", "path", "status", "agent_id", "note", "created_at", "updated_at", "machine_id"],
  task_commits: ["id", "task_id", "sha", "message", "author", "files_changed", "committed_at", "created_at"],
  task_git_refs: ["id", "task_id", "ref_type", "name", "url", "provider", "metadata", "created_at", "updated_at"],
  task_verifications: ["id", "task_id", "command", "status", "output_summary", "artifact_path", "agent_id", "run_at", "created_at"],
  saved_views: ["id", "name", "description", "scope", "filters", "created_at", "updated_at"],
  task_boards: ["id", "name", "scope", "project_id", "task_list_id", "plan_id", "agent_id", "lanes", "filters", "created_at", "updated_at"],
};

const tableByKey: Record<keyof TodosLocalBridgeData, string> = {
  projects: "projects",
  task_lists: "task_lists",
  plans: "plans",
  tasks: "tasks",
  task_dependencies: "task_dependencies",
  comments: "task_comments",
  runs: "task_runs",
  run_events: "task_run_events",
  run_commands: "task_run_commands",
  run_artifacts: "task_run_artifacts",
  task_files: "task_files",
  task_commits: "task_commits",
  task_git_refs: "task_git_refs",
  task_verifications: "task_verifications",
  saved_views: "saved_search_views",
  task_boards: "task_boards",
};

const jsonColumns = new Set(["metadata", "tags", "data", "files_changed", "filters", "lanes"]);

function packageSource(version: string): TodosLocalBridgePackageSource {
  return {
    packageName: "@hasna/todos",
    repository: "hasna/todos",
    version,
  };
}

function emptyCounts(): Record<keyof TodosLocalBridgeData, number> {
  return Object.fromEntries(dataKeys.map((key) => [key, 0])) as Record<keyof TodosLocalBridgeData, number>;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseJsonArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function scopedTaskIds(projectId: string | undefined, db: Database): string[] {
  const rows = projectId
    ? db.query("SELECT id FROM tasks WHERE project_id = ? ORDER BY created_at").all(projectId) as Array<{ id: string }>
    : db.query("SELECT id FROM tasks ORDER BY created_at").all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

function queryByTaskIds<T>(db: Database, sql: string, taskIds: string[]): T[] {
  if (taskIds.length === 0) return [];
  const placeholders = taskIds.map(() => "?").join(",");
  return db.query(sql.replace("__TASK_IDS__", placeholders)).all(...taskIds) as T[];
}

function queryByRunIds<T>(db: Database, sql: string, runIds: string[]): T[] {
  if (runIds.length === 0) return [];
  const placeholders = runIds.map(() => "?").join(",");
  return db.query(sql.replace("__RUN_IDS__", placeholders)).all(...runIds) as T[];
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    ...row,
    tags: parseJsonArray<string>(row.tags),
    metadata: parseJsonObject(row.metadata),
    requires_approval: Boolean(row.requires_approval),
  } as Task;
}

function rowToTaskList(row: Record<string, unknown>): TaskList {
  return { ...row, metadata: parseJsonObject(row.metadata) } as TaskList;
}

function rowWithMetadata<T>(row: Record<string, unknown>): T {
  return { ...row, metadata: parseJsonObject(row.metadata) } as T;
}

function rowToRunEvent(row: Record<string, unknown>): TaskRunEvent {
  return { ...row, data: parseJsonObject(row.data) } as TaskRunEvent;
}

function rowToCommit(row: Record<string, unknown>): TaskCommit {
  return { ...row, files_changed: row.files_changed ? parseJsonArray<string>(row.files_changed) : null } as TaskCommit;
}

function rowToSavedView(row: Record<string, unknown>): SavedSearchView {
  return { ...row, filters: parseJsonObject(row.filters) } as unknown as SavedSearchView;
}

function rowToTaskBoard(row: Record<string, unknown>): TaskBoard {
  return {
    ...row,
    lanes: parseJsonArray(row.lanes),
    filters: parseJsonObject(row.filters),
  } as unknown as TaskBoard;
}

function bridgeStats(data: TodosLocalBridgeData): Record<keyof TodosLocalBridgeData, number> {
  return Object.fromEntries(dataKeys.map((key) => [key, data[key].length])) as Record<keyof TodosLocalBridgeData, number>;
}

export function createLocalBridgeBundle(
  options: ExportLocalBridgeOptions = {},
  db?: Database,
): TodosLocalBridgeBundle {
  const d = db || getDatabase();
  const taskIds = scopedTaskIds(options.project_id, d);
  const runRows = queryByTaskIds<Record<string, unknown>>(
    d,
    "SELECT * FROM task_runs WHERE task_id IN (__TASK_IDS__) ORDER BY started_at, created_at",
    taskIds,
  );
  const runIds = runRows.map((row) => String(row.id));
  const project = options.project_id
    ? d.query("SELECT * FROM projects WHERE id = ?").get(options.project_id) as Project | null
    : null;
  const data: TodosLocalBridgeData = redactValue({
    projects: options.project_id
      ? (project ? [project] : [])
      : d.query("SELECT * FROM projects ORDER BY name").all() as Project[],
    task_lists: (options.project_id
      ? d.query("SELECT * FROM task_lists WHERE project_id = ? ORDER BY name").all(options.project_id) as Record<string, unknown>[]
      : d.query("SELECT * FROM task_lists ORDER BY name").all() as Record<string, unknown>[]).map(rowToTaskList),
    plans: options.project_id
      ? d.query("SELECT * FROM plans WHERE project_id = ? ORDER BY created_at").all(options.project_id) as Plan[]
      : d.query("SELECT * FROM plans ORDER BY created_at").all() as Plan[],
    tasks: queryByTaskIds<Record<string, unknown>>(
      d,
      "SELECT * FROM tasks WHERE id IN (__TASK_IDS__) ORDER BY created_at",
      taskIds,
    ).map(rowToTask),
    task_dependencies: queryByTaskIds<TaskDependency>(
      d,
      "SELECT task_id, depends_on, external_project_id, external_task_id FROM task_dependencies WHERE task_id IN (__TASK_IDS__) ORDER BY task_id, depends_on",
      taskIds,
    ),
    comments: queryByTaskIds<TaskComment>(
      d,
      "SELECT * FROM task_comments WHERE task_id IN (__TASK_IDS__) ORDER BY created_at, id",
      taskIds,
    ),
    runs: runRows.map(rowWithMetadata<TaskRun>),
    run_events: queryByRunIds<Record<string, unknown>>(
      d,
      "SELECT * FROM task_run_events WHERE run_id IN (__RUN_IDS__) ORDER BY created_at, id",
      runIds,
    ).map(rowToRunEvent),
    run_commands: queryByRunIds<TaskRunCommand>(
      d,
      "SELECT * FROM task_run_commands WHERE run_id IN (__RUN_IDS__) ORDER BY created_at, id",
      runIds,
    ),
    run_artifacts: queryByRunIds<Record<string, unknown>>(
      d,
      "SELECT * FROM task_run_artifacts WHERE run_id IN (__RUN_IDS__) ORDER BY created_at, id",
      runIds,
    ).map(rowWithMetadata<TaskRunArtifact>),
    task_files: queryByTaskIds<TaskFile>(
      d,
      "SELECT * FROM task_files WHERE task_id IN (__TASK_IDS__) ORDER BY path, id",
      taskIds,
    ),
    task_commits: queryByTaskIds<Record<string, unknown>>(
      d,
      "SELECT * FROM task_commits WHERE task_id IN (__TASK_IDS__) ORDER BY created_at, id",
      taskIds,
    ).map(rowToCommit),
    task_git_refs: queryByTaskIds<Record<string, unknown>>(
      d,
      "SELECT * FROM task_git_refs WHERE task_id IN (__TASK_IDS__) ORDER BY created_at, id",
      taskIds,
    ).map(rowWithMetadata<TaskGitRef>),
    task_verifications: queryByTaskIds<TaskVerification>(
      d,
      "SELECT * FROM task_verifications WHERE task_id IN (__TASK_IDS__) ORDER BY run_at, id",
      taskIds,
    ),
    saved_views: (options.project_id
      ? d.query("SELECT * FROM saved_search_views WHERE json_extract(filters, '$.project_id') = ? ORDER BY name").all(options.project_id) as Record<string, unknown>[]
      : d.query("SELECT * FROM saved_search_views ORDER BY name").all() as Record<string, unknown>[]).map(rowToSavedView),
    task_boards: (options.project_id
      ? d.query("SELECT * FROM task_boards WHERE project_id = ? ORDER BY name").all(options.project_id) as Record<string, unknown>[]
      : d.query("SELECT * FROM task_boards ORDER BY name").all() as Record<string, unknown>[]).map(rowToTaskBoard),
  }) as TodosLocalBridgeData;

  const artifactContents = data.run_artifacts
    .map((artifact) => exportStoredArtifactContent({
      id: artifact.id,
      path: artifact.path,
      size_bytes: artifact.size_bytes,
      sha256: artifact.sha256,
      metadata: artifact.metadata,
    }))
    .filter((content): content is ExportedArtifactContent => Boolean(content));

  return {
    schemaVersion: TODOS_LOCAL_BRIDGE_SCHEMA_VERSION,
    kind: TODOS_LOCAL_BRIDGE_KIND,
    exportedAt: options.generatedAt ?? now(),
    package: packageSource(options.version ?? getPackageVersion(import.meta.url)),
    source: {
      project_id: options.project_id ?? null,
      project_path: project?.path ?? null,
    },
    data,
    artifact_contents: artifactContents,
    stats: bridgeStats(data),
  };
}

export function validateLocalBridgeBundle(value: unknown): LocalBridgeValidationResult {
  const issues: string[] = [];
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!record) {
    return { ok: false, issues: ["bundle must be an object"] };
  }
  if (record.kind !== TODOS_LOCAL_BRIDGE_KIND) issues.push(`kind must be ${TODOS_LOCAL_BRIDGE_KIND}`);
  if (record.schemaVersion !== TODOS_LOCAL_BRIDGE_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${TODOS_LOCAL_BRIDGE_SCHEMA_VERSION}`);
  }
  const data = record.data && typeof record.data === "object" && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : null;
  if (!data) {
    issues.push("data must be an object");
  } else {
    for (const key of dataKeys) {
      if ((key === "saved_views" || key === "task_boards") && data[key] === undefined) continue;
      if (!Array.isArray(data[key])) issues.push(`data.${key} must be an array`);
    }
  }
  if (record.artifact_contents !== undefined && !Array.isArray(record.artifact_contents)) {
    issues.push("artifact_contents must be an array when present");
  }
  return { ok: issues.length === 0, issues };
}

function existsById(db: Database, table: string, id: string): boolean {
  return Boolean(db.query(`SELECT id FROM ${table} WHERE id = ?`).get(id));
}

function dependencyExists(db: Database, row: TaskDependency): boolean {
  return Boolean(db
    .query("SELECT task_id FROM task_dependencies WHERE task_id = ? AND depends_on = ?")
    .get(row.task_id, row.depends_on));
}

function missingDependency(db: Database, tableKey: keyof TodosLocalBridgeData, row: Record<string, unknown>): string | null {
  const taskId = typeof row.task_id === "string" ? row.task_id : null;
  const runId = typeof row.run_id === "string" ? row.run_id : null;
  if (taskId && !existsById(db, "tasks", taskId)) return taskId;
  if (runId && !existsById(db, "task_runs", runId)) return runId;
  if (tableKey === "task_dependencies") {
    const dependsOn = typeof row.depends_on === "string" ? row.depends_on : null;
    if (dependsOn && !existsById(db, "tasks", dependsOn)) return dependsOn;
  }
  return null;
}

function prepareValue(column: string, value: unknown): SQLQueryBindings {
  if (column === "requires_approval") return value ? 1 : 0;
  if (jsonColumns.has(column)) return JSON.stringify(value ?? (column === "tags" || column === "files_changed" ? [] : {}));
  return value === undefined ? null : value as SQLQueryBindings;
}

function insertRecord(
  db: Database,
  tableKey: keyof TodosLocalBridgeData,
  row: Record<string, unknown>,
): boolean {
  const table = tableByKey[tableKey];
  const columns = insertColumns[tableKey];
  const placeholders = columns.map(() => "?").join(", ");
  const params = columns.map((column) => prepareValue(column, row[column]));
  const result = db.run(
    `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
    params,
  );
  if (tableKey === "tasks" && result.changes > 0) {
    const tags = parseJsonArray<string>(row.tags);
    const stmt = db.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)");
    for (const tag of tags) {
      if (tag) stmt.run(row.id as string, tag);
    }
  }
  return result.changes > 0;
}

function sortedTasks(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visited = new Set<string>();
  const result: Task[] = [];
  const visit = (task: Task) => {
    if (visited.has(task.id)) return;
    if (task.parent_id && byId.has(task.parent_id)) visit(byId.get(task.parent_id)!);
    visited.add(task.id);
    result.push(task);
  };
  for (const task of tasks) visit(task);
  return result;
}

function normalizeComparable(value: unknown): unknown {
  if (value === undefined || value === "") return null;
  return value;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeComparable(left)) === JSON.stringify(normalizeComparable(right));
}

function isMissingValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function mergeStringArray(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right])).filter(Boolean);
}

function safeMergeMetadata(
  localMetadata: Record<string, unknown>,
  incomingMetadata: Record<string, unknown>,
): { metadata: Record<string, unknown>; unresolvedFields: string[] } {
  const metadata = { ...localMetadata };
  const unresolvedFields: string[] = [];
  for (const [key, incomingValue] of Object.entries(incomingMetadata)) {
    if (key === "sync_conflicts") {
      if (!Array.isArray(metadata[key]) && Array.isArray(incomingValue)) metadata[key] = incomingValue;
      continue;
    }
    if (!(key in metadata) || isMissingValue(metadata[key])) {
      metadata[key] = incomingValue;
      continue;
    }
    if (!valuesEqual(metadata[key], incomingValue)) {
      unresolvedFields.push(`metadata.${key}`);
    }
  }
  return { metadata, unresolvedFields };
}

function buildDivergenceNotes(fields: string[]): string {
  return `Local bridge import kept local values for divergent fields: ${fields.join(", ")}`;
}

function safeMergeTask(
  db: Database,
  incoming: Task,
  options: { dryRun: boolean },
): { merged: boolean; unresolvedFields: string[] } {
  const current = getTask(incoming.id, db);
  if (!current) return { merged: false, unresolvedFields: [] };
  const updates: Partial<Parameters<typeof updateTask>[1]> = {};
  const unresolvedFields: string[] = [];

  const fillFields = [
    "description",
    "assigned_to",
    "due_at",
    "estimated_minutes",
    "actual_minutes",
    "confidence",
    "task_type",
  ] as const;
  for (const field of fillFields) {
    const localValue = current[field];
    const incomingValue = incoming[field];
    if (isMissingValue(localValue) && !isMissingValue(incomingValue)) {
      (updates as Record<string, unknown>)[field] = incomingValue;
    } else if (!valuesEqual(localValue, incomingValue) && !isMissingValue(incomingValue)) {
      unresolvedFields.push(field);
    }
  }

  for (const field of ["title", "status", "priority"] as const) {
    if (!valuesEqual(current[field], incoming[field])) unresolvedFields.push(field);
  }

  const mergedTags = mergeStringArray(current.tags, incoming.tags);
  if (!valuesEqual(current.tags, mergedTags)) updates.tags = mergedTags;

  const metadataMerge = safeMergeMetadata(current.metadata, incoming.metadata);
  let mergedMetadata = metadataMerge.metadata;
  unresolvedFields.push(...metadataMerge.unresolvedFields);
  if (unresolvedFields.length > 0) {
    mergedMetadata = appendSyncConflict(mergedMetadata, {
      agent: "local-bridge",
      direction: "pull",
      prefer: "local",
      local_updated_at: current.updated_at,
      remote_updated_at: incoming.updated_at,
      detected_at: now(),
      notes: buildDivergenceNotes(unresolvedFields),
    }, 10);
  }
  if (!valuesEqual(current.metadata, mergedMetadata)) updates.metadata = mergedMetadata;

  const merged = Object.keys(updates).length > 0;
  if (merged && !options.dryRun) {
    updateTask(incoming.id, { ...updates, version: current.version }, db);
  }
  return { merged, unresolvedFields };
}

export function importLocalBridgeBundle(
  bundle: TodosLocalBridgeBundle,
  options: ImportLocalBridgeOptions = {},
  db?: Database,
): LocalBridgeImportResult {
  const d = db || getDatabase();
  const validation = validateLocalBridgeBundle(bundle);
  const inserted = emptyCounts();
  const merged = emptyCounts();
  const skipped = emptyCounts();
  const conflicts: LocalBridgeImportConflict[] = [];
  const issues: string[] = [];
  if (!validation.ok) {
    return { ok: false, dry_run: options.dryRun !== false, inserted, merged, skipped, conflicts, issues: validation.issues };
  }

  const dryRun = options.dryRun !== false;
  const conflictStrategy = options.conflictStrategy ?? "skip";
  const data: TodosLocalBridgeData = {
    ...bundle.data,
    tasks: sortedTasks(bundle.data.tasks),
    saved_views: bundle.data.saved_views ?? [],
    task_boards: bundle.data.task_boards ?? [],
  };

  for (const key of dataKeys) {
    for (const row of data[key] as unknown as Array<Record<string, unknown>>) {
      const table = tableByKey[key];
      const id = key === "task_dependencies"
        ? `${row.task_id}->${row.depends_on}`
        : String(row.id);
      const exists = key === "task_dependencies"
        ? dependencyExists(d, row as unknown as TaskDependency)
        : existsById(d, table, id);
      if (exists) {
        if (key === "tasks" && conflictStrategy === "safe_merge") {
          const merge = safeMergeTask(d, row as unknown as Task, { dryRun });
          if (merge.merged || merge.unresolvedFields.length > 0) {
            if (merge.merged) merged[key]++;
            if (merge.unresolvedFields.length > 0) {
              conflicts.push({
                table,
                id,
                reason: "diverged",
                fields: merge.unresolvedFields,
                resolution: merge.merged ? "manual_required" : "skipped",
              });
            }
            continue;
          }
        }
        skipped[key]++;
        conflicts.push({ table, id, reason: "already_exists" });
        continue;
      }
      const missing = missingDependency(d, key, row);
      if (missing) {
        skipped[key]++;
        conflicts.push({ table, id, reason: "missing_dependency" });
        continue;
      }
      if (!dryRun && insertRecord(d, key, row)) inserted[key]++;
      if (dryRun) inserted[key]++;
    }
  }

  if (!dryRun && Array.isArray(bundle.artifact_contents)) {
    for (const content of bundle.artifact_contents) {
      const report = importStoredArtifactContent(content);
      if (report.status !== "ok") issues.push(`artifact ${content.artifact_id}: ${report.message}`);
    }
  }
  return { ok: conflicts.every((conflict) => conflict.reason !== "missing_dependency") && issues.length === 0, dry_run: dryRun, inserted, merged, skipped, conflicts, issues };
}
