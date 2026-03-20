import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";

export interface TaskFile {
  id: string;
  task_id: string;
  path: string;
  status: "planned" | "active" | "modified" | "reviewed" | "removed";
  agent_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AddTaskFileInput {
  task_id: string;
  path: string;
  status?: TaskFile["status"];
  agent_id?: string;
  note?: string;
}

export function addTaskFile(input: AddTaskFileInput, db?: Database): TaskFile {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  // Upsert: if same task+path exists, update status/note/agent
  const existing = d.query(
    "SELECT id FROM task_files WHERE task_id = ? AND path = ?",
  ).get(input.task_id, input.path) as { id: string } | null;

  if (existing) {
    d.run(
      "UPDATE task_files SET status = ?, agent_id = ?, note = ?, updated_at = ? WHERE id = ?",
      [input.status || "active", input.agent_id || null, input.note || null, timestamp, existing.id],
    );
    return getTaskFile(existing.id, d)!;
  }

  d.run(
    `INSERT INTO task_files (id, task_id, path, status, agent_id, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.task_id, input.path, input.status || "active", input.agent_id || null, input.note || null, timestamp, timestamp],
  );
  return getTaskFile(id, d)!;
}

export function getTaskFile(id: string, db?: Database): TaskFile | null {
  const d = db || getDatabase();
  return d.query("SELECT * FROM task_files WHERE id = ?").get(id) as TaskFile | null;
}

export function listTaskFiles(taskId: string, db?: Database): TaskFile[] {
  const d = db || getDatabase();
  return d.query(
    "SELECT * FROM task_files WHERE task_id = ? ORDER BY path",
  ).all(taskId) as TaskFile[];
}

export function findTasksByFile(path: string, db?: Database): TaskFile[] {
  const d = db || getDatabase();
  return d.query(
    "SELECT * FROM task_files WHERE path = ? AND status != 'removed' ORDER BY updated_at DESC",
  ).all(path) as TaskFile[];
}

export function updateTaskFileStatus(
  taskId: string,
  path: string,
  status: TaskFile["status"],
  agentId?: string,
  db?: Database,
): TaskFile | null {
  const d = db || getDatabase();
  const timestamp = now();
  d.run(
    "UPDATE task_files SET status = ?, agent_id = COALESCE(?, agent_id), updated_at = ? WHERE task_id = ? AND path = ?",
    [status, agentId || null, timestamp, taskId, path],
  );
  const row = d.query(
    "SELECT * FROM task_files WHERE task_id = ? AND path = ?",
  ).get(taskId, path) as TaskFile | null;
  return row;
}

export function removeTaskFile(taskId: string, path: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run(
    "DELETE FROM task_files WHERE task_id = ? AND path = ?",
    [taskId, path],
  );
  return result.changes > 0;
}

export interface FileConflict {
  path: string;
  conflicting_task_id: string;
  conflicting_agent_id: string | null;
  conflicting_task_title: string;
  conflicting_task_status: string;
}

/**
 * Check if adding a file to a task would conflict with another in-progress task.
 * Returns conflicts (not a hard block — caller decides what to do).
 */
export function detectFileConflicts(taskId: string, paths: string[], db?: Database): FileConflict[] {
  const d = db || getDatabase();
  if (paths.length === 0) return [];

  const placeholders = paths.map(() => "?").join(", ");
  const rows = d.query(`
    SELECT tf.path, tf.agent_id AS conflicting_agent_id, t.id AS conflicting_task_id,
           t.title AS conflicting_task_title, t.status AS conflicting_task_status
    FROM task_files tf
    JOIN tasks t ON tf.task_id = t.id
    WHERE tf.path IN (${placeholders})
      AND tf.task_id != ?
      AND tf.status != 'removed'
      AND t.status = 'in_progress'
    ORDER BY tf.updated_at DESC
  `).all(...paths, taskId) as FileConflict[];

  return rows;
}

export interface BulkFileResult {
  path: string;
  tasks: TaskFile[];
  has_conflict: boolean;
  in_progress_count: number;
}

export function bulkFindTasksByFiles(paths: string[], db?: Database): BulkFileResult[] {
  const d = db || getDatabase();
  if (paths.length === 0) return [];

  const placeholders = paths.map(() => "?").join(", ");
  const rows = d.query(
    `SELECT tf.*, t.status AS task_status FROM task_files tf
     JOIN tasks t ON tf.task_id = t.id
     WHERE tf.path IN (${placeholders}) AND tf.status != 'removed'
     ORDER BY tf.updated_at DESC`,
  ).all(...paths) as (TaskFile & { task_status: string })[];

  // Group by path
  const byPath = new Map<string, (TaskFile & { task_status: string })[]>();
  for (const path of paths) byPath.set(path, []);
  for (const row of rows) {
    byPath.get(row.path)?.push(row);
  }

  return paths.map((path) => {
    const tasks = byPath.get(path) ?? [];
    const inProgressCount = tasks.filter((t) => t.task_status === "in_progress").length;
    return {
      path,
      tasks,
      has_conflict: inProgressCount > 1,
      in_progress_count: inProgressCount,
    };
  });
}

export interface ActiveFileInfo {
  path: string;
  file_status: TaskFile["status"];
  file_agent_id: string | null;
  note: string | null;
  updated_at: string;
  task_id: string;
  task_short_id: string | null;
  task_title: string;
  task_status: string;
  task_locked_by: string | null;
  task_locked_at: string | null;
  agent_id: string | null;
  agent_name: string | null;
}

export function listActiveFiles(db?: Database): ActiveFileInfo[] {
  const d = db || getDatabase();
  return d.query(`
    SELECT
      tf.path,
      tf.status AS file_status,
      tf.agent_id AS file_agent_id,
      tf.note,
      tf.updated_at,
      t.id AS task_id,
      t.short_id AS task_short_id,
      t.title AS task_title,
      t.status AS task_status,
      t.locked_by AS task_locked_by,
      t.locked_at AS task_locked_at,
      a.id AS agent_id,
      a.name AS agent_name
    FROM task_files tf
    JOIN tasks t ON tf.task_id = t.id
    LEFT JOIN agents a ON (tf.agent_id = a.id OR (tf.agent_id IS NULL AND t.assigned_to = a.id))
    WHERE t.status = 'in_progress'
      AND tf.status != 'removed'
    ORDER BY tf.updated_at DESC
  `).all() as ActiveFileInfo[];
}

export interface FileHeatMapEntry {
  path: string;
  edit_count: number;
  unique_agents: number;
  agent_ids: string[];
  last_edited_at: string;
  active_task_count: number;
}

export function getFileHeatMap(
  opts?: { limit?: number; project_id?: string; min_edits?: number },
  db?: Database
): FileHeatMapEntry[] {
  const d = db || getDatabase();
  const limit = opts?.limit ?? 20;
  const minEdits = opts?.min_edits ?? 1;

  const rows = d.query(`
    SELECT
      tf.path,
      COUNT(*) AS edit_count,
      COUNT(DISTINCT COALESCE(tf.agent_id, t.assigned_to)) AS unique_agents,
      GROUP_CONCAT(DISTINCT COALESCE(tf.agent_id, t.assigned_to)) AS agent_ids,
      MAX(tf.updated_at) AS last_edited_at,
      SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS active_task_count
    FROM task_files tf
    JOIN tasks t ON tf.task_id = t.id
    WHERE tf.status != 'removed'
    ${opts?.project_id ? `AND t.project_id = '${opts.project_id}'` : ''}
    GROUP BY tf.path
    HAVING edit_count >= ${minEdits}
    ORDER BY edit_count DESC, last_edited_at DESC
    LIMIT ${limit}
  `).all() as Array<{
    path: string;
    edit_count: number;
    unique_agents: number;
    agent_ids: string | null;
    last_edited_at: string;
    active_task_count: number;
  }>;

  return rows.map((r) => ({
    path: r.path,
    edit_count: r.edit_count,
    unique_agents: r.unique_agents,
    agent_ids: r.agent_ids ? r.agent_ids.split(',').filter(Boolean) : [],
    last_edited_at: r.last_edited_at,
    active_task_count: r.active_task_count,
  }));
}

export function bulkAddTaskFiles(
  taskId: string,
  paths: string[],
  agentId?: string,
  db?: Database,
): TaskFile[] {
  const d = db || getDatabase();
  const results: TaskFile[] = [];
  const tx = d.transaction(() => {
    for (const path of paths) {
      results.push(addTaskFile({ task_id: taskId, path, agent_id: agentId }, d));
    }
  });
  tx();
  return results;
}
