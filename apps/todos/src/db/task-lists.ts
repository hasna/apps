import type { Database } from "bun:sqlite";
import type { CreateTaskListInput, TaskList, TaskListRow, UpdateTaskListInput } from "../types/index.js";
import { ResourceConflictError, TaskListNotFoundError } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { slugify } from "./projects.js";
import { currentStorageMachineId, recordStorageTombstone } from "./storage-tombstones.js";
import { normalizeSlug } from "../lib/slugs.js";
import { claimCanonicalSlug, releaseCanonicalSlugClaims, taskListSlugScopeKey } from "./slug-claims.js";

function rowToTaskList(row: TaskListRow): TaskList {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

export function createTaskList(input: CreateTaskListInput, db?: Database): TaskList {
  const d = getDatabase(db);
  return d.transaction(() => {
    const id = uuid();
    const timestamp = now();
    const slug = normalizeSlug(input.slug === undefined ? input.name : input.slug);
    if (!slug) throw new Error("Invalid task-list slug — must be non-empty kebab-case");
    const machineId = currentStorageMachineId(d);
    const scopeKey = taskListSlugScopeKey(input.project_id);

    const existing = input.project_id
      ? d.query("SELECT id FROM task_lists WHERE project_id = ? AND slug = ?").get(input.project_id, slug)
      : d.query("SELECT id FROM task_lists WHERE project_id IS NULL AND slug = ?").get(slug);
    if (existing || !claimCanonicalSlug("task_list", scopeKey, slug, id, d)) {
      throw new ResourceConflictError("TASK_LIST_SLUG_CONFLICT", `Task list with slug "${slug}" already exists in this scope`);
    }

    d.run(
      `INSERT INTO task_lists (id, project_id, slug, name, description, metadata, created_at, updated_at, machine_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.project_id || null, slug, input.name, input.description || null, JSON.stringify(input.metadata || {}), timestamp, timestamp, machineId],
    );
    return getTaskList(id, d)!;
  })();
}

export function getTaskList(id: string, db?: Database): TaskList | null {
  const d = getDatabase(db);
  const row = d.query("SELECT * FROM task_lists WHERE id = ?").get(id) as TaskListRow | null;
  return row ? rowToTaskList(row) : null;
}

export function getTaskListBySlug(slug: string, projectId?: string, db?: Database): TaskList | null {
  const d = getDatabase(db);
  let row: TaskListRow | null;
  if (projectId) {
    row = d.query("SELECT * FROM task_lists WHERE slug = ? AND project_id = ?").get(slug, projectId) as TaskListRow | null;
  } else {
    row = d.query("SELECT * FROM task_lists WHERE slug = ? AND project_id IS NULL").get(slug) as TaskListRow | null;
  }
  return row ? rowToTaskList(row) : null;
}

export function listTaskLists(projectId?: string, db?: Database): TaskList[] {
  const d = getDatabase(db);
  if (projectId) {
    return (d.query("SELECT * FROM task_lists WHERE project_id = ? ORDER BY name").all(projectId) as TaskListRow[]).map(rowToTaskList);
  }
  return (d.query("SELECT * FROM task_lists ORDER BY name").all() as TaskListRow[]).map(rowToTaskList);
}

export function updateTaskList(id: string, input: UpdateTaskListInput, db?: Database): TaskList {
  const d = getDatabase(db);
  return d.transaction(() => {
    const existing = getTaskList(id, d);
    if (!existing) throw new TaskListNotFoundError(id);

    const sets: string[] = ["updated_at = ?"];
    const params: (string | null)[] = [now()];

    if (input.slug !== undefined) {
      const slug = slugify(input.slug);
      if (!slug) throw new Error("Invalid task-list slug — must be non-empty kebab-case");
      const duplicate = existing.project_id
        ? d.query("SELECT id FROM task_lists WHERE project_id = ? AND slug = ? AND id != ?").get(existing.project_id, slug, id)
        : d.query("SELECT id FROM task_lists WHERE project_id IS NULL AND slug = ? AND id != ?").get(slug, id);
      if (duplicate) {
        throw new ResourceConflictError("TASK_LIST_SLUG_CONFLICT", `Task list with slug "${slug}" already exists in this scope`);
      }
      if (slug !== existing.slug) {
        releaseCanonicalSlugClaims("task_list", id, d);
        if (!claimCanonicalSlug("task_list", taskListSlugScopeKey(existing.project_id), slug, id, d)) {
          throw new ResourceConflictError("TASK_LIST_SLUG_CONFLICT", `Task list with slug "${slug}" already exists in this scope`);
        }
      }
      sets.push("slug = ?");
      params.push(slug);
    }
    if (input.name !== undefined) {
      sets.push("name = ?");
      params.push(input.name);
    }
    if (input.description !== undefined) {
      sets.push("description = ?");
      params.push(input.description);
    }
    if (input.metadata !== undefined) {
      sets.push("metadata = ?");
      params.push(JSON.stringify(input.metadata));
    }

    params.push(id);
    d.run(`UPDATE task_lists SET ${sets.join(", ")} WHERE id = ?`, params);
    return getTaskList(id, d)!;
  })();
}

export function deleteTaskList(id: string, db?: Database): boolean {
  const d = getDatabase(db);
  const list = getTaskList(id, d);
  if (!list) return false;
  recordStorageTombstone({
    object_type: "task_lists",
    object_id: id,
    payload: list as unknown as Record<string, unknown>,
  }, d);
  return d.transaction(() => {
    releaseCanonicalSlugClaims("task_list", id, d);
    return d.run("DELETE FROM task_lists WHERE id = ?", [id]).changes > 0;
  })();
}

export function ensureTaskList(name: string, slug: string, projectId?: string, db?: Database): TaskList {
  const d = getDatabase(db);
  const existing = getTaskListBySlug(slug, projectId, d);
  if (existing) return existing;
  return createTaskList({ name, slug, project_id: projectId }, d);
}
