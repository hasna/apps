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
