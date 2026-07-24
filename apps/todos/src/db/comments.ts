import type { Database } from "bun:sqlite";
import type { CreateCommentInput, TaskComment } from "../types/index.js";
import { TaskNotFoundError } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { getTask } from "./tasks.js";
import { redactEvidenceText } from "../lib/redaction.js";

export function addComment(
  input: CreateCommentInput,
  db?: Database,
): TaskComment {
  const d = getDatabase(db);

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
      redactEvidenceText(input.content),
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
  const d = getDatabase(db);
  return d
    .query("SELECT * FROM task_comments WHERE id = ?")
    .get(id) as TaskComment | null;
}

export function listComments(taskId: string, db?: Database): TaskComment[] {
  const d = getDatabase(db);
  return d
    .query(
      // Preserve local insertion-order semantics for same-clock comments. The
      // cloud/Postgres cursor path uses `(created_at, id)` because it cannot
      // rely on SQLite rowid and requires a portable stable keyset.
      "SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at, rowid",
    )
    .all(taskId) as TaskComment[];
}

export function updateComment(
  id: string,
  input: { content: string },
  db?: Database,
): TaskComment {
  const d = getDatabase(db);
  d.run("UPDATE task_comments SET content = ? WHERE id = ?", [redactEvidenceText(input.content), id]);
  const comment = getComment(id, d);
  if (!comment) {
    throw new Error(`Comment not found: ${id}`);
  }
  return comment;
}

export function deleteComment(id: string, db?: Database): boolean {
  const d = getDatabase(db);
  const result = d.run("DELETE FROM task_comments WHERE id = ?", [id]);
  return result.changes > 0;
}
