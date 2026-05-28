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
  query?: string;
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

function hasFts(db: Database): boolean {
  try {
    const result = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks_fts'").get();
    return result !== null;
  } catch {
    return false;
  }
}

function escapeFtsQuery(q: string): string {
  // Escape FTS5 special characters and wrap tokens for prefix matching
  // Strip characters that FTS5 treats as operators to avoid syntax errors
  return q
    .replace(/["*^()]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(token => `"${token}"*`)
    .join(" ");
}

export function searchTasks(
  options: SearchOptions | string,
  projectId?: string,
  taskListId?: string,
  db?: Database,
): Task[] {
  // Support old signature for backward compatibility
  const opts: SearchOptions = typeof options === "string"
    ? { query: options || undefined, project_id: projectId, task_list_id: taskListId }
    : options;

  const d = db || getDatabase();
  clearExpiredLocks(d);

  const params: SQLQueryBindings[] = [];
  let sql: string;

  const raw = opts.query?.trim() ?? "";
  // "*" means "match everything" — treat as no query (filter-only mode)
  const q = raw === "*" ? "" : raw;

  if (hasFts(d) && q) {
    // FTS5 path — BM25-ranked full-text search
    const ftsQuery = escapeFtsQuery(q);
    sql = `SELECT t.* FROM tasks t
      INNER JOIN tasks_fts fts ON fts.rowid = t.rowid
      WHERE tasks_fts MATCH ?`;
    params.push(ftsQuery);
  } else if (q) {
    // Fallback: LIKE pattern match
    const pattern = `%${q}%`;
    sql = `SELECT * FROM tasks t WHERE (t.title LIKE ? OR t.description LIKE ? OR EXISTS (SELECT 1 FROM task_tags WHERE task_tags.task_id = t.id AND tag LIKE ?))`;
    params.push(pattern, pattern, pattern);
  } else {
    // No query — filter-only mode, return all tasks matching filters
    sql = `SELECT * FROM tasks t WHERE 1=1`;
  }

  if (opts.project_id) {
    sql += " AND t.project_id = ?";
    params.push(opts.project_id);
  }

  if (opts.task_list_id) {
    sql += " AND t.task_list_id = ?";
    params.push(opts.task_list_id);
  }

  if (opts.status) {
    if (Array.isArray(opts.status)) {
      sql += ` AND t.status IN (${opts.status.map(() => "?").join(",")})`;
      params.push(...opts.status);
    } else {
      sql += " AND t.status = ?";
      params.push(opts.status);
    }
  }

  if (opts.priority) {
    if (Array.isArray(opts.priority)) {
      sql += ` AND t.priority IN (${opts.priority.map(() => "?").join(",")})`;
      params.push(...opts.priority);
    } else {
      sql += " AND t.priority = ?";
      params.push(opts.priority);
    }
  }

  if (opts.assigned_to) {
    sql += " AND t.assigned_to = ?";
    params.push(opts.assigned_to);
  }

  if (opts.agent_id) {
    sql += " AND t.agent_id = ?";
    params.push(opts.agent_id);
  }

  if (opts.created_after) {
    sql += " AND t.created_at > ?";
    params.push(opts.created_after);
  }

  if (opts.updated_after) {
    sql += " AND t.updated_at > ?";
    params.push(opts.updated_after);
  }

  if (opts.has_dependencies === true) {
    sql += " AND t.id IN (SELECT task_id FROM task_dependencies)";
  } else if (opts.has_dependencies === false) {
    sql += " AND t.id NOT IN (SELECT task_id FROM task_dependencies)";
  }

  if (opts.is_blocked === true) {
    sql += " AND t.id IN (SELECT td.task_id FROM task_dependencies td JOIN tasks dep ON dep.id = td.depends_on WHERE dep.status != 'completed')";
  } else if (opts.is_blocked === false) {
    sql += " AND t.id NOT IN (SELECT td.task_id FROM task_dependencies td JOIN tasks dep ON dep.id = td.depends_on WHERE dep.status != 'completed')";
  }

  if (hasFts(d) && q) {
    // FTS5: sort by BM25 relevance first, then priority, then recency
    sql += ` ORDER BY bm25(tasks_fts),
      CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
      t.created_at DESC`;
  } else {
    sql += ` ORDER BY
      CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
      t.created_at DESC`;
  }

  const rows = d.query(sql).all(...params) as TaskRow[];
  return rows.map(rowToTask);
}
