import type { Database, SQLQueryBindings } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { listAgents } from "../db/agents.js";
import { getRecentActivity } from "../db/audit.js";
import { listPlans } from "../db/plans.js";
import { listProjects } from "../db/projects.js";
import { listTaskLists } from "../db/task-lists.js";
import { listTasks, replaceTaskTags } from "../db/tasks.js";
import { listTemplates } from "../db/templates.js";
import type {
  TodosStorageImportResult,
  TodosStorageSnapshot,
} from "./interfaces.js";

const PROJECT_COLUMNS = [
  "id", "name", "path", "description", "task_list_id", "task_prefix", "task_counter",
  "created_at", "updated_at", "machine_id", "synced_at",
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
  const d = db ?? getDatabase();
  return {
    exportedAt: new Date().toISOString(),
    source: "sqlite",
    tasks: listTasks({ include_archived: true }, d),
    projects: listProjects(d),
    plans: listPlans(undefined, d),
    agents: listAgents({ include_archived: true }, d),
    taskLists: listTaskLists(undefined, d),
    templates: listTemplates(d),
    auditHistory: getRecentActivity(Number.MAX_SAFE_INTEGER, d),
  };
}

export function importSqliteTodosStorageSnapshot(
  snapshot: TodosStorageSnapshot,
  db?: Database,
): TodosStorageImportResult {
  const d = db ?? getDatabase();
  const result: TodosStorageImportResult = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  const applyRows = (
    table: string,
    columns: readonly string[],
    rows: readonly unknown[],
    updateClockColumn?: string,
    afterUpsert?: (row: Record<string, unknown>, changed: boolean) => void,
  ) => {
    for (const row of rows) {
      try {
        const record = asRecord(row);
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

  applyRows("projects", PROJECT_COLUMNS, snapshot.projects, "updated_at");
  applyRows("agents", AGENT_COLUMNS, snapshot.agents, "last_seen_at");
  applyRows("task_lists", TASK_LIST_COLUMNS, snapshot.taskLists, "updated_at");
  applyRows("plans", PLAN_COLUMNS, snapshot.plans, "updated_at");
  applyRows("task_templates", TEMPLATE_COLUMNS, snapshot.templates);
  applyRows("tasks", TASK_COLUMNS, sortedTasks(snapshot.tasks), "updated_at", (row, changed) => {
    if (changed && Array.isArray(row["tags"]) && typeof row["id"] === "string") {
      replaceTaskTags(row["id"], row["tags"].filter((tag): tag is string => typeof tag === "string"), d);
    }
  });
  applyRows("task_history", AUDIT_COLUMNS, snapshot.auditHistory);

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
  const updateSet = updateColumns.map((column) => `${column} = excluded.${column}`).join(", ");
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
