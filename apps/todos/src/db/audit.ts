import type { Database } from "bun:sqlite";
import type { TaskHistory } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

export function logTaskChange(
  taskId: string,
  action: string,
  field?: string,
  oldValue?: string | null,
  newValue?: string | null,
  agentId?: string | null,
  db?: Database,
): TaskHistory {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  d.run(
    `INSERT INTO task_history (id, task_id, action, field, old_value, new_value, agent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, taskId, action, field || null, oldValue ?? null, newValue ?? null, agentId || null, timestamp],
  );
  return { id, task_id: taskId, action, field: field || null, old_value: oldValue ?? null, new_value: newValue ?? null, agent_id: agentId || null, created_at: timestamp };
}

export function getTaskHistory(taskId: string, db?: Database): TaskHistory[] {
  const d = db || getDatabase();
  return d.query("SELECT * FROM task_history WHERE task_id = ? ORDER BY created_at DESC").all(taskId) as TaskHistory[];
}

export function getRecentActivity(limit = 50, db?: Database): TaskHistory[] {
  const d = db || getDatabase();
  return d.query("SELECT * FROM task_history ORDER BY created_at DESC LIMIT ?").all(limit) as TaskHistory[];
}
