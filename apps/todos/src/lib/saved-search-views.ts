import type { Database, SQLQueryBindings } from "bun:sqlite";
import { getDatabase, now, uuid } from "../db/database.js";
import type { Plan, Project, Task, TaskComment, TaskStatus, TaskPriority } from "../types/index.js";
import type { TaskRun } from "../db/task-runs.js";
import { queryTasksByLocalFields, type LocalTaskFieldQuery } from "./local-fields.js";
import { searchTasks, type SearchOptions } from "./search.js";

export type SavedSearchScope = "all" | "tasks" | "projects" | "plans" | "runs" | "comments";

export interface SavedSearchFilters {
  query?: string;
  project_id?: string;
  task_list_id?: string;
  plan_id?: string;
  task_id?: string;
  status?: string | string[];
  priority?: TaskPriority | TaskPriority[];
  assigned_to?: string;
  agent_id?: string;
  tags?: string[];
  local_fields?: LocalTaskFieldQuery;
  created_after?: string;
  updated_after?: string;
  has_dependencies?: boolean;
  is_blocked?: boolean;
  depends_on?: string;
  blocks?: string;
  limit?: number;
}

export interface SavedSearchView {
  id: string;
  name: string;
  description: string | null;
  scope: SavedSearchScope;
  filters: SavedSearchFilters;
  created_at: string;
  updated_at: string;
}

interface SavedSearchViewRow extends Omit<SavedSearchView, "filters" | "scope"> {
  scope: string;
  filters: string | null;
}

export type SearchResultEntity = Task | Project | Plan | TaskRun | TaskComment;

export interface SavedSearchResult {
  entity_type: Exclude<SavedSearchScope, "all">;
  entity: SearchResultEntity;
}

export interface SavedSearchRunResult {
  view?: SavedSearchView;
  scope: SavedSearchScope;
  filters: SavedSearchFilters;
  count: number;
  results: SavedSearchResult[];
}

export interface SaveSearchViewInput {
  name: string;
  description?: string | null;
  scope?: SavedSearchScope;
  filters?: SavedSearchFilters;
}

function parseFilters(value: string | null): SavedSearchFilters {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as SavedSearchFilters
      : {};
  } catch {
    return {};
  }
}

function rowToSavedSearchView(row: SavedSearchViewRow): SavedSearchView {
  return {
    ...row,
    scope: normalizeScope(row.scope),
    filters: parseFilters(row.filters),
  };
}

export function normalizeScope(scope: string | undefined | null): SavedSearchScope {
  if (scope === "all" || scope === "tasks" || scope === "projects" || scope === "plans" || scope === "runs" || scope === "comments") {
    return scope;
  }
  return "tasks";
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error("Saved view name is required");
  return normalized;
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit || limit <= 0) return 100;
  return Math.min(Math.trunc(limit), 1000);
}

function valuesList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map((item) => item.trim()).filter(Boolean);
}

function addStatusFilter(sql: string, params: SQLQueryBindings[], column: string, value: string | string[] | undefined): string {
  const values = valuesList(value);
  if (values.length === 0) return sql;
  params.push(...values);
  return `${sql} AND ${column} IN (${values.map(() => "?").join(",")})`;
}

function addDateFilter(sql: string, params: SQLQueryBindings[], column: string, value: string | undefined): string {
  if (!value) return sql;
  params.push(value);
  return `${sql} AND ${column} > ?`;
}

function likePattern(query: string | undefined): string | null {
  const trimmed = query?.trim();
  if (!trimmed || trimmed === "*") return null;
  return `%${trimmed}%`;
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

function rowToTaskRun(row: Record<string, unknown>): TaskRun {
  return { ...row, metadata: parseJsonObject(row.metadata) } as TaskRun;
}

function taskMatchesSavedFilters(task: Task, filters: SavedSearchFilters, db: Database): boolean {
  if (filters.plan_id && task.plan_id !== filters.plan_id) return false;
  if (filters.tags && !filters.tags.every((tag) => task.tags.includes(tag))) return false;
  if (filters.depends_on) {
    const row = db.query("SELECT 1 FROM task_dependencies WHERE task_id = ? AND depends_on = ?").get(task.id, filters.depends_on);
    if (!row) return false;
  }
  if (filters.blocks) {
    const row = db.query("SELECT 1 FROM task_dependencies WHERE task_id = ? AND depends_on = ?").get(filters.blocks, task.id);
    if (!row) return false;
  }
  return true;
}

function searchTaskEntities(filters: SavedSearchFilters, db: Database): Task[] {
  let tasks: Task[];
  if (filters.local_fields) {
    const localMatches = queryTasksByLocalFields({ ...filters.local_fields, limit: 10000 }, db);
    const allowedIds = new Set(localMatches.map((task) => task.id));
    tasks = searchTasks({
      query: filters.query,
      project_id: filters.project_id,
      task_list_id: filters.task_list_id,
      status: filters.status as TaskStatus | TaskStatus[] | undefined,
      priority: filters.priority,
      assigned_to: filters.assigned_to,
      agent_id: filters.agent_id,
      created_after: filters.created_after,
      updated_after: filters.updated_after,
      has_dependencies: filters.has_dependencies,
      is_blocked: filters.is_blocked,
    } satisfies SearchOptions, undefined, undefined, db).filter((task) => allowedIds.has(task.id));
  } else {
    tasks = searchTasks({
      query: filters.query,
      project_id: filters.project_id,
      task_list_id: filters.task_list_id,
      status: filters.status as TaskStatus | TaskStatus[] | undefined,
      priority: filters.priority,
      assigned_to: filters.assigned_to,
      agent_id: filters.agent_id,
      created_after: filters.created_after,
      updated_after: filters.updated_after,
      has_dependencies: filters.has_dependencies,
      is_blocked: filters.is_blocked,
    } satisfies SearchOptions, undefined, undefined, db);
  }
  return tasks.filter((task) => taskMatchesSavedFilters(task, filters, db)).slice(0, normalizeLimit(filters.limit));
}

function searchProjects(filters: SavedSearchFilters, db: Database): Project[] {
  const params: SQLQueryBindings[] = [];
  let sql = "SELECT * FROM projects WHERE 1=1";
  if (filters.project_id) {
    sql += " AND id = ?";
    params.push(filters.project_id);
  }
  const pattern = likePattern(filters.query);
  if (pattern) {
    sql += " AND (name LIKE ? OR description LIKE ? OR path LIKE ?)";
    params.push(pattern, pattern, pattern);
  }
  sql = addDateFilter(sql, params, "created_at", filters.created_after);
  sql = addDateFilter(sql, params, "updated_at", filters.updated_after);
  sql += " ORDER BY name LIMIT ?";
  params.push(normalizeLimit(filters.limit));
  return db.query(sql).all(...params) as Project[];
}

function searchPlans(filters: SavedSearchFilters, db: Database): Plan[] {
  const params: SQLQueryBindings[] = [];
  let sql = "SELECT * FROM plans WHERE 1=1";
  if (filters.project_id) {
    sql += " AND project_id = ?";
    params.push(filters.project_id);
  }
  if (filters.task_list_id) {
    sql += " AND task_list_id = ?";
    params.push(filters.task_list_id);
  }
  if (filters.agent_id) {
    sql += " AND agent_id = ?";
    params.push(filters.agent_id);
  }
  sql = addStatusFilter(sql, params, "status", filters.status);
  const pattern = likePattern(filters.query);
  if (pattern) {
    sql += " AND (name LIKE ? OR description LIKE ?)";
    params.push(pattern, pattern);
  }
  sql = addDateFilter(sql, params, "created_at", filters.created_after);
  sql = addDateFilter(sql, params, "updated_at", filters.updated_after);
  sql += " ORDER BY updated_at DESC, created_at DESC LIMIT ?";
  params.push(normalizeLimit(filters.limit));
  return db.query(sql).all(...params) as Plan[];
}

function searchRuns(filters: SavedSearchFilters, db: Database): TaskRun[] {
  const params: SQLQueryBindings[] = [];
  let sql = `SELECT r.* FROM task_runs r
    JOIN tasks t ON t.id = r.task_id
    WHERE 1=1`;
  if (filters.project_id) {
    sql += " AND t.project_id = ?";
    params.push(filters.project_id);
  }
  if (filters.task_list_id) {
    sql += " AND t.task_list_id = ?";
    params.push(filters.task_list_id);
  }
  if (filters.plan_id) {
    sql += " AND t.plan_id = ?";
    params.push(filters.plan_id);
  }
  if (filters.task_id) {
    sql += " AND r.task_id = ?";
    params.push(filters.task_id);
  }
  if (filters.agent_id) {
    sql += " AND r.agent_id = ?";
    params.push(filters.agent_id);
  }
  sql = addStatusFilter(sql, params, "r.status", filters.status);
  const pattern = likePattern(filters.query);
  if (pattern) {
    sql += " AND (r.title LIKE ? OR r.summary LIKE ? OR t.title LIKE ?)";
    params.push(pattern, pattern, pattern);
  }
  sql = addDateFilter(sql, params, "r.created_at", filters.created_after);
  sql = addDateFilter(sql, params, "r.updated_at", filters.updated_after);
  sql += " ORDER BY r.started_at DESC, r.created_at DESC LIMIT ?";
  params.push(normalizeLimit(filters.limit));
  return (db.query(sql).all(...params) as Record<string, unknown>[]).map(rowToTaskRun);
}

function searchComments(filters: SavedSearchFilters, db: Database): TaskComment[] {
  const params: SQLQueryBindings[] = [];
  let sql = `SELECT c.* FROM task_comments c
    JOIN tasks t ON t.id = c.task_id
    WHERE 1=1`;
  if (filters.project_id) {
    sql += " AND t.project_id = ?";
    params.push(filters.project_id);
  }
  if (filters.task_list_id) {
    sql += " AND t.task_list_id = ?";
    params.push(filters.task_list_id);
  }
  if (filters.plan_id) {
    sql += " AND t.plan_id = ?";
    params.push(filters.plan_id);
  }
  if (filters.task_id) {
    sql += " AND c.task_id = ?";
    params.push(filters.task_id);
  }
  if (filters.agent_id) {
    sql += " AND c.agent_id = ?";
    params.push(filters.agent_id);
  }
  const pattern = likePattern(filters.query);
  if (pattern) {
    sql += " AND (c.content LIKE ? OR t.title LIKE ?)";
    params.push(pattern, pattern);
  }
  sql = addDateFilter(sql, params, "c.created_at", filters.created_after);
  sql += " ORDER BY c.created_at DESC, c.id LIMIT ?";
  params.push(normalizeLimit(filters.limit));
  return db.query(sql).all(...params) as TaskComment[];
}

function toResults<T extends SearchResultEntity>(entityType: SavedSearchResult["entity_type"], rows: T[]): SavedSearchResult[] {
  return rows.map((entity) => ({ entity_type: entityType, entity }));
}

export function runSavedSearch(filters: SavedSearchFilters = {}, scope: SavedSearchScope = "tasks", db?: Database): SavedSearchRunResult {
  const d = db || getDatabase();
  const normalizedScope = normalizeScope(scope);
  const scopes = normalizedScope === "all"
    ? ["tasks", "projects", "plans", "runs", "comments"] as const
    : [normalizedScope] as const;
  const results: SavedSearchResult[] = [];
  for (const item of scopes) {
    if (item === "tasks") results.push(...toResults("tasks", searchTaskEntities(filters, d)));
    if (item === "projects") results.push(...toResults("projects", searchProjects(filters, d)));
    if (item === "plans") results.push(...toResults("plans", searchPlans(filters, d)));
    if (item === "runs") results.push(...toResults("runs", searchRuns(filters, d)));
    if (item === "comments") results.push(...toResults("comments", searchComments(filters, d)));
  }
  return {
    scope: normalizedScope,
    filters,
    count: results.length,
    results: results.slice(0, normalizeLimit(filters.limit)),
  };
}

export function saveSearchView(input: SaveSearchViewInput, db?: Database): SavedSearchView {
  const d = db || getDatabase();
  const name = normalizeName(input.name);
  const timestamp = now();
  const existing = getSearchView(name, d);
  if (existing) {
    d.run(
      `UPDATE saved_search_views
       SET description = ?, scope = ?, filters = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.description ?? existing.description,
        normalizeScope(input.scope ?? existing.scope),
        JSON.stringify(input.filters ?? existing.filters),
        timestamp,
        existing.id,
      ],
    );
    return getSearchView(existing.id, d)!;
  }
  const id = uuid();
  d.run(
    `INSERT INTO saved_search_views (id, name, description, scope, filters, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      name,
      input.description ?? null,
      normalizeScope(input.scope),
      JSON.stringify(input.filters ?? {}),
      timestamp,
      timestamp,
    ],
  );
  return getSearchView(id, d)!;
}

export function getSearchView(idOrName: string, db?: Database): SavedSearchView | null {
  const d = db || getDatabase();
  const row = d.query(
    "SELECT * FROM saved_search_views WHERE id = ? OR name = ?",
  ).get(idOrName, idOrName) as SavedSearchViewRow | null;
  return row ? rowToSavedSearchView(row) : null;
}

export function listSearchViews(scope?: SavedSearchScope, db?: Database): SavedSearchView[] {
  const d = db || getDatabase();
  const normalizedScope = scope ? normalizeScope(scope) : null;
  const rows = normalizedScope
    ? d.query("SELECT * FROM saved_search_views WHERE scope = ? ORDER BY name").all(normalizedScope) as SavedSearchViewRow[]
    : d.query("SELECT * FROM saved_search_views ORDER BY name").all() as SavedSearchViewRow[];
  return rows.map(rowToSavedSearchView);
}

export function deleteSearchView(idOrName: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM saved_search_views WHERE id = ? OR name = ?", [idOrName, idOrName]);
  return result.changes > 0;
}

export function runSearchView(idOrName: string, db?: Database): SavedSearchRunResult {
  const d = db || getDatabase();
  const view = getSearchView(idOrName, d);
  if (!view) throw new Error(`Saved search view not found: ${idOrName}`);
  return { ...runSavedSearch(view.filters, view.scope, d), view };
}
