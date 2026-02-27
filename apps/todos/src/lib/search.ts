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
  };
}

export function searchTasks(
  query: string,
  projectId?: string,
  db?: Database,
): Task[] {
  const d = db || getDatabase();
  clearExpiredLocks(d);
  const pattern = `%${query}%`;

  let sql = `SELECT * FROM tasks WHERE (title LIKE ? OR description LIKE ? OR EXISTS (SELECT 1 FROM task_tags WHERE task_tags.task_id = tasks.id AND tag LIKE ?))`;
  const params: SQLQueryBindings[] = [pattern, pattern, pattern];

  if (projectId) {
    sql += " AND project_id = ?";
    params.push(projectId);
  }

  sql += ` ORDER BY
    CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
    created_at DESC`;

  const rows = d.query(sql).all(...params) as TaskRow[];
  return rows.map(rowToTask);
}
