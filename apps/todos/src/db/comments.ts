import type { Database } from "bun:sqlite";
import type { CreateCommentInput, TaskComment } from "../types/index.js";
import { TaskNotFoundError } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { getTask } from "./tasks.js";

export function addComment(
  input: CreateCommentInput,
  db?: Database,
): TaskComment {
  const d = db || getDatabase();

  // Verify task exists
  if (!getTask(input.task_id, d)) {
    throw new TaskNotFoundError(input.task_id);
  }

  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO task_comments (id, task_id, agent_id, session_id, content, type, progress_pct, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.task_id,
      input.agent_id || null,
      input.session_id || null,
      input.content,
      input.type || 'comment',
      input.progress_pct ?? null,
      timestamp,
    ],
  );

  return getComment(id, d)!;
}

export function logProgress(
  taskId: string,
  message: string,
  pct?: number,
  agentId?: string,
  db?: Database,
): TaskComment {
  return addComment({ task_id: taskId, content: message, type: 'progress', progress_pct: pct, agent_id: agentId }, db);
}

export function getComment(id: string, db?: Database): TaskComment | null {
  const d = db || getDatabase();
  return d
    .query("SELECT * FROM task_comments WHERE id = ?")
    .get(id) as TaskComment | null;
}

export function listComments(taskId: string, db?: Database): TaskComment[] {
  const d = db || getDatabase();
  return d
    .query(
      "SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at",
    )
    .all(taskId) as TaskComment[];
}

export function deleteComment(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM task_comments WHERE id = ?", [id]);
  return result.changes > 0;
}
