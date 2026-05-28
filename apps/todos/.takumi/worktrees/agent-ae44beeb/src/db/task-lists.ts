import type { Database } from "bun:sqlite";
import type { CreateTaskListInput, TaskList, TaskListRow, UpdateTaskListInput } from "../types/index.js";
import { TaskListNotFoundError } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { slugify } from "./projects.js";

function rowToTaskList(row: TaskListRow): TaskList {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

export function createTaskList(input: CreateTaskListInput, db?: Database): TaskList {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  const slug = input.slug || slugify(input.name);

  // For standalone task lists (no project), enforce slug uniqueness manually
  // SQLite UNIQUE(project_id, slug) treats NULL project_ids as distinct
  if (!input.project_id) {
    const existing = d.query(
      "SELECT id FROM task_lists WHERE project_id IS NULL AND slug = ?",
    ).get(slug) as { id: string } | null;
    if (existing) {
      throw new Error(`Standalone task list with slug "${slug}" already exists`);
    }
  }

  d.run(
    `INSERT INTO task_lists (id, project_id, slug, name, description, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.project_id || null, slug, input.name, input.description || null, JSON.stringify(input.metadata || {}), timestamp, timestamp],
  );

  return getTaskList(id, d)!;
}

export function getTaskList(id: string, db?: Database): TaskList | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM task_lists WHERE id = ?").get(id) as TaskListRow | null;
  return row ? rowToTaskList(row) : null;
}

export function getTaskListBySlug(slug: string, projectId?: string, db?: Database): TaskList | null {
  const d = db || getDatabase();
  let row: TaskListRow | null;
  if (projectId) {
    row = d.query("SELECT * FROM task_lists WHERE slug = ? AND project_id = ?").get(slug, projectId) as TaskListRow | null;
  } else {
    row = d.query("SELECT * FROM task_lists WHERE slug = ? AND project_id IS NULL").get(slug) as TaskListRow | null;
  }
  return row ? rowToTaskList(row) : null;
}

export function listTaskLists(projectId?: string, db?: Database): TaskList[] {
  const d = db || getDatabase();
  if (projectId) {
    return (d.query("SELECT * FROM task_lists WHERE project_id = ? ORDER BY name").all(projectId) as TaskListRow[]).map(rowToTaskList);
  }
  return (d.query("SELECT * FROM task_lists ORDER BY name").all() as TaskListRow[]).map(rowToTaskList);
}

export function updateTaskList(id: string, input: UpdateTaskListInput, db?: Database): TaskList {
  const d = db || getDatabase();
  const existing = getTaskList(id, d);
  if (!existing) throw new TaskListNotFoundError(id);

  const sets: string[] = ["updated_at = ?"];
  const params: (string | null)[] = [now()];

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
}

export function deleteTaskList(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM task_lists WHERE id = ?", [id]).changes > 0;
}

export function ensureTaskList(name: string, slug: string, projectId?: string, db?: Database): TaskList {
  const d = db || getDatabase();
  const existing = getTaskListBySlug(slug, projectId, d);
  if (existing) return existing;
  return createTaskList({ name, slug, project_id: projectId }, d);
}
