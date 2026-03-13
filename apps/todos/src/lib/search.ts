import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { Task, TaskRow } from "../types/index.js";
import { clearExpiredLocks, getDatabase } from "../db/database.js";

function rowToTask(row: TaskRow): Task {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]") as string[],
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
    status: row.status as Task["status"],
    priority: row.priority as Task["priority"],
    requires_approval: Boolean(row.requires_approval),
  };
}

export interface SearchOptions {
  query: string;
  project_id?: string;
  task_list_id?: string;
  status?: string | string[];
  priority?: string | string[];
  assigned_to?: string;
  agent_id?: string;
  created_after?: string;
  updated_after?: string;
  has_dependencies?: boolean;
  is_blocked?: boolean;
}

export function searchTasks(
  options: SearchOptions | string,
  projectId?: string,
  taskListId?: string,
  db?: Database,
): Task[] {
  // Support old signature for backward compatibility
  const opts: SearchOptions = typeof options === "string"
    ? { query: options, project_id: projectId, task_list_id: taskListId }
    : options;

  const d = db || getDatabase();
  clearExpiredLocks(d);
  const pattern = `%${opts.query}%`;

  let sql = `SELECT * FROM tasks WHERE (title LIKE ? OR description LIKE ? OR EXISTS (SELECT 1 FROM task_tags WHERE task_tags.task_id = tasks.id AND tag LIKE ?))`;
  const params: SQLQueryBindings[] = [pattern, pattern, pattern];

  if (opts.project_id) {
    sql += " AND project_id = ?";
    params.push(opts.project_id);
  }

  if (opts.task_list_id) {
    sql += " AND task_list_id = ?";
    params.push(opts.task_list_id);
  }

  if (opts.status) {
    if (Array.isArray(opts.status)) {
      sql += ` AND status IN (${opts.status.map(() => "?").join(",")})`;
      params.push(...opts.status);
    } else {
      sql += " AND status = ?";
      params.push(opts.status);
    }
  }

  if (opts.priority) {
    if (Array.isArray(opts.priority)) {
      sql += ` AND priority IN (${opts.priority.map(() => "?").join(",")})`;
      params.push(...opts.priority);
    } else {
      sql += " AND priority = ?";
      params.push(opts.priority);
    }
  }

  if (opts.assigned_to) {
    sql += " AND assigned_to = ?";
    params.push(opts.assigned_to);
  }

  if (opts.agent_id) {
    sql += " AND agent_id = ?";
    params.push(opts.agent_id);
  }

  if (opts.created_after) {
    sql += " AND created_at > ?";
    params.push(opts.created_after);
  }

  if (opts.updated_after) {
    sql += " AND updated_at > ?";
    params.push(opts.updated_after);
  }

  if (opts.has_dependencies === true) {
    sql += " AND id IN (SELECT task_id FROM task_dependencies)";
  } else if (opts.has_dependencies === false) {
    sql += " AND id NOT IN (SELECT task_id FROM task_dependencies)";
  }

  if (opts.is_blocked === true) {
    sql += " AND id IN (SELECT td.task_id FROM task_dependencies td JOIN tasks dep ON dep.id = td.depends_on WHERE dep.status != 'completed')";
  } else if (opts.is_blocked === false) {
    sql += " AND id NOT IN (SELECT td.task_id FROM task_dependencies td JOIN tasks dep ON dep.id = td.depends_on WHERE dep.status != 'completed')";
  }

  sql += ` ORDER BY
    CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
    created_at DESC`;

  const rows = d.query(sql).all(...params) as TaskRow[];
  return rows.map(rowToTask);
}
