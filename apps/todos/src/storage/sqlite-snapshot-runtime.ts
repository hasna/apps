// Heavy SQLite snapshot implementation. The published wrapper loads this only
// after proving an explicit local process role.
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { listAgents } from "../db/agents.js";
import { getRecentActivity } from "../db/audit.js";
import { listPlans } from "../db/plans.js";
import { listProjects } from "../db/projects.js";
import { listTaskLists } from "../db/task-lists.js";
import { listTasks, replaceTaskTags } from "../db/tasks.js";
import { listTemplates } from "../db/templates.js";
import {
  getStorageTombstone,
  listStorageTombstones,
  recordStorageTombstone,
  shouldApplyStorageTombstone,
  type StorageTombstoneObjectType,
} from "../db/storage-tombstones.js";
import type {
  TodosStorageImportResult,
  TodosStorageSnapshot,
  TodosStorageTombstone,
  TodosProjectMachinePath,
} from "./interfaces.js";
import { validateSnapshotRoutingDestinationConflicts, validateSnapshotRoutingRecords } from "../lib/slugs.js";
import { assertTodosLocalStorageRole } from "./config.js";

const PROJECT_COLUMNS = [
  "id", "name", "path", "description", "task_list_id", "task_prefix", "task_counter",
  "created_at", "updated_at", "machine_id", "synced_at",
] as const;

const PROJECT_MACHINE_PATH_COLUMNS = [
  "id", "project_id", "machine_id", "path", "created_at", "updated_at",
] as const;

const TASK_LIST_COLUMNS = [
  "id", "project_id", "slug", "name", "description", "metadata", "created_at",
  "updated_at", "machine_id", "synced_at",
] as const;

const PLAN_COLUMNS = [
  "id", "project_id", "task_list_id", "agent_id", "name", "description", "status",
  "created_at", "updated_at", "machine_id", "synced_at",
] as const;

const AGENT_COLUMNS = [
  "id", "name", "description", "role", "title", "level", "permissions", "capabilities",
  "reports_to", "org_id", "metadata", "status", "created_at", "last_seen_at",
  "session_id", "working_dir", "active_project_id", "machine_id", "synced_at",
] as const;

const TEMPLATE_COLUMNS = [
  "id", "name", "title_pattern", "description", "priority", "tags", "variables",
  "project_id", "plan_id", "metadata", "version", "created_at", "machine_id", "synced_at",
] as const;

const TASK_COLUMNS = [
  "id", "short_id", "project_id", "parent_id", "plan_id", "task_list_id", "title",
  "description", "status", "priority", "agent_id", "assigned_to", "session_id",
  "working_dir", "tags", "metadata", "version", "locked_by", "locked_at",
  "created_at", "updated_at", "started_at", "completed_at", "due_at",
  "estimated_minutes", "actual_minutes", "requires_approval", "approved_by",
  "approved_at", "recurrence_rule", "recurrence_parent_id", "spawns_template_id",
  "confidence", "reason", "spawned_from_session", "assigned_by", "assigned_from_project",
  "task_type", "cost_tokens", "cost_usd", "delegated_from", "delegation_depth",
  "retry_count", "max_retries", "retry_after", "sla_minutes", "runner_id",
  "runner_started_at", "runner_completed_at", "current_step", "total_steps", "cycle_id",
  "machine_id", "synced_at", "archived_at",
] as const;

const AUDIT_COLUMNS = [
  "id", "task_id", "action", "field", "old_value", "new_value", "agent_id",
  "created_at", "machine_id",
] as const;

const JSON_COLUMNS = new Set(["tags", "metadata", "permissions", "capabilities", "variables"]);
const BOOLEAN_COLUMNS = new Set(["requires_approval"]);

export function exportSqliteTodosStorageSnapshot(db?: Database): TodosStorageSnapshot {
  assertTodosLocalStorageRole();
  const d = getDatabase(db);
  return {
    exportedAt: new Date().toISOString(),
    source: "sqlite",
    tasks: listTasks({ include_archived: true }, d),
    projects: listProjects(d),
    projectMachinePaths: listProjectMachinePaths(d),
    plans: listPlans(undefined, d),
    agents: listAgents({ include_archived: true }, d),
    taskLists: listTaskLists(undefined, d),
    templates: listTemplates(d),
    auditHistory: getRecentActivity(Number.MAX_SAFE_INTEGER, d),
    tombstones: listStorageTombstones(d),
  };
}

export function importSqliteTodosStorageSnapshot(
  snapshot: TodosStorageSnapshot,
  db?: Database,
): TodosStorageImportResult {
  assertTodosLocalStorageRole();
  const d = getDatabase(db);
  const result: TodosStorageImportResult = {
    inserted: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    errors: [],
  };
  result.errors.push(...validateSnapshotRoutingRecords(snapshot.projects, snapshot.taskLists));
  if (result.errors.length === 0) {
    const existingProjects = d.query("SELECT id, task_list_id FROM projects").all() as Array<{ id: string; task_list_id: string | null }>;
    const existingTaskLists = d.query("SELECT id, project_id, slug FROM task_lists").all() as Array<{
      id: string;
      project_id: string | null;
      slug: string;
    }>;
    result.errors.push(...validateSnapshotRoutingDestinationConflicts(
      snapshot.projects,
      snapshot.taskLists,
      existingProjects,
      existingTaskLists,
    ));
  }
  // Preflight the full snapshot before any write so malformed routing metadata
  // cannot leave an otherwise-valid prefix partially imported.
  if (result.errors.length > 0) return result;

  const applyRows = (
    objectType: StorageTombstoneObjectType,
    table: string,
    columns: readonly string[],
    rows: readonly unknown[],
    updateClockColumn?: string,
    afterUpsert?: (row: Record<string, unknown>, changed: boolean) => void,
  ) => {
    for (const row of rows) {
      try {
        const record = asRecord(row);
        const tombstone = typeof record["id"] === "string"
          ? getStorageTombstone(objectType, record["id"], d)
          : null;
        if (tombstone && shouldApplyStorageTombstone(tombstone, rowClock(record, updateClockColumn))) {
          result.skipped += 1;
          continue;
        }
        const state = upsertById(d, table, columns, record, updateClockColumn);
        if (state === "inserted") result.inserted += 1;
        else if (state === "updated") result.updated += 1;
        else result.skipped += 1;
        afterUpsert?.(record, state !== "skipped");
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  };

  applyRows("projects", "projects", PROJECT_COLUMNS, snapshot.projects, "updated_at");
  applyRows("project_machine_paths", "project_machine_paths", PROJECT_MACHINE_PATH_COLUMNS, snapshot.projectMachinePaths ?? [], "updated_at");
  applyRows("agents", "agents", AGENT_COLUMNS, snapshot.agents, "last_seen_at");
  applyRows("task_lists", "task_lists", TASK_LIST_COLUMNS, snapshot.taskLists, "updated_at");
  applyRows("plans", "plans", PLAN_COLUMNS, snapshot.plans, "updated_at");
  applyRows("templates", "task_templates", TEMPLATE_COLUMNS, snapshot.templates);
  applyRows("tasks", "tasks", TASK_COLUMNS, sortedTasks(snapshot.tasks), "updated_at", (row, changed) => {
    if (changed && Array.isArray(row["tags"]) && typeof row["id"] === "string") {
      replaceTaskTags(row["id"], row["tags"].filter((tag): tag is string => typeof tag === "string"), d);
    }
  });
  applyRows("audit_history", "task_history", AUDIT_COLUMNS, snapshot.auditHistory);
  applyTombstones(d, snapshot.tombstones ?? [], result);

  return result;
}

function upsertById(
  db: Database,
  table: string,
  columns: readonly string[],
  row: Record<string, unknown>,
  updateClockColumn?: string,
): "inserted" | "updated" | "skipped" {
  const id = row["id"];
  if (typeof id !== "string" || !id) throw new Error(`${table} row is missing id`);
  const presentColumns = columns.filter((column) => column in row);
  if (!presentColumns.includes("id")) presentColumns.unshift("id");
  const existing = existsById(db, table, id);
  const placeholders = presentColumns.map(() => "?").join(", ");
  const values = presentColumns.map((column) => valueForColumn(column, row[column]));
  const updateColumns = presentColumns.filter((column) => column !== "id");
  // L8: never let an imported (remote) row lower the local optimistic-lock
  // version — take the max so concurrent local writers don't regress. On insert
  // the incoming value is used as-is (MAX(NULL, x) short-circuits via COALESCE).
  const updateSet = updateColumns
    .map((column) => (column === "version"
      ? `version = MAX(COALESCE(${table}.version, 0), excluded.version)`
      : `${column} = excluded.${column}`))
    .join(", ");
  const clockGuard = updateClockColumn && presentColumns.includes(updateClockColumn)
    ? ` WHERE ${table}.${updateClockColumn} IS NULL OR ${table}.${updateClockColumn} <= excluded.${updateClockColumn}`
    : "";
  const sql = updateSet
    ? `INSERT INTO ${table} (${presentColumns.join(", ")}) VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${updateSet}${clockGuard}`
    : `INSERT OR IGNORE INTO ${table} (${presentColumns.join(", ")}) VALUES (${placeholders})`;
  const changes = db.run(sql, values).changes;
  if (changes === 0) return "skipped";
  return existing ? "updated" : "inserted";
}

function existsById(db: Database, table: string, id: string): boolean {
  return Boolean(db.query(`SELECT id FROM ${table} WHERE id = ?`).get(id));
}

function valueForColumn(column: string, value: unknown): SQLQueryBindings {
  if (BOOLEAN_COLUMNS.has(column)) return value ? 1 : 0;
  if (JSON_COLUMNS.has(column)) return JSON.stringify(value ?? (column === "tags" || column === "permissions" || column === "capabilities" || column === "variables" ? [] : {}));
  return value === undefined ? null : value as SQLQueryBindings;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("snapshot rows must be objects");
  }
  return value as Record<string, unknown>;
}

function sortedTasks(tasks: TodosStorageSnapshot["tasks"]): TodosStorageSnapshot["tasks"] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const seen = new Set<string>();
  const result: TodosStorageSnapshot["tasks"] = [];
  const visit = (task: TodosStorageSnapshot["tasks"][number]) => {
    if (seen.has(task.id)) return;
    if (task.parent_id && byId.has(task.parent_id)) visit(byId.get(task.parent_id)!);
    seen.add(task.id);
    result.push(task);
  };
  for (const task of tasks) visit(task);
  return result;
}

function applyTombstones(
  db: Database,
  tombstones: readonly TodosStorageTombstone[],
  result: TodosStorageImportResult,
): void {
  for (const tombstone of tombstones) {
    try {
      recordStorageTombstone({
        object_type: tombstone.object_type,
        object_id: tombstone.object_id,
        deleted_at: tombstone.deleted_at,
        source_machine_id: tombstone.source_machine_id ?? null,
        payload: tombstone.payload ?? null,
        version: tombstone.version ?? null,
      }, db);
      const table = tableForTombstone(tombstone.object_type);
      const existing = existingClock(db, table, tombstone.object_id);
      if (!shouldApplyStorageTombstone(tombstone, existing)) {
        result.skipped += 1;
        continue;
      }
      const deletedTags = table === "tasks"
        ? db.run("DELETE FROM task_tags WHERE task_id = ?", [tombstone.object_id]).changes
        : 0;
      const deleted = db.run(`DELETE FROM ${table} WHERE id = ?`, [tombstone.object_id]).changes;
      if (deleted > 0 || deletedTags > 0) result.deleted = (result.deleted ?? 0) + 1;
      else result.skipped += 1;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
}

function tableForTombstone(objectType: TodosStorageTombstone["object_type"]): string {
  if (objectType === "tasks") return "tasks";
  if (objectType === "projects") return "projects";
  if (objectType === "project_machine_paths") return "project_machine_paths";
  if (objectType === "plans") return "plans";
  if (objectType === "agents") return "agents";
  if (objectType === "task_lists") return "task_lists";
  if (objectType === "templates") return "task_templates";
  return "task_history";
}

function listRows<T extends readonly string[]>(
  db: Database,
  table: string,
  columns: T,
): Array<Record<T[number], unknown>> {
  return db.query(`SELECT ${columns.join(", ")} FROM ${table} ORDER BY id`).all() as Array<Record<T[number], unknown>>;
}

function listProjectMachinePaths(db: Database): TodosProjectMachinePath[] {
  return listRows(db, "project_machine_paths", PROJECT_MACHINE_PATH_COLUMNS).map((row) => ({
    id: String(row.id),
    project_id: String(row.project_id),
    machine_id: String(row.machine_id),
    path: String(row.path),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }));
}

function existingClock(db: Database, table: string, id: string): string | null {
  const clockColumns = clockColumnsForTable(table);
  const row = db.query(`SELECT ${clockColumns.join(", ")} FROM ${table} WHERE id = ?`).get(id) as Record<string, string | null> | null;
  return row?.updated_at ?? row?.last_seen_at ?? row?.created_at ?? null;
}

function rowClock(row: Record<string, unknown>, updateClockColumn?: string): string | null {
  const value = updateClockColumn ? row[updateClockColumn] : null;
  return stringClock(value)
    ?? stringClock(row["updated_at"])
    ?? stringClock(row["last_seen_at"])
    ?? stringClock(row["created_at"]);
}

function stringClock(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function clockColumnsForTable(table: string): string[] {
  if (table === "agents") return ["last_seen_at", "created_at"];
  if (table === "task_templates") return ["created_at"];
  if (table === "task_history") return ["created_at"];
  return ["updated_at", "created_at"];
}
