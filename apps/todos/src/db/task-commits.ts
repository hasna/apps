import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";

export interface TaskCommit {
  id: string;
  task_id: string;
  sha: string;
  message: string | null;
  author: string | null;
  files_changed: string[] | null;
  committed_at: string | null;
  created_at: string;
}

interface TaskCommitRow {
  id: string;
  task_id: string;
  sha: string;
  message: string | null;
  author: string | null;
  files_changed: string | null;
  committed_at: string | null;
  created_at: string;
}

function rowToCommit(row: TaskCommitRow): TaskCommit {
  return {
    ...row,
    files_changed: row.files_changed ? JSON.parse(row.files_changed) : null,
  };
}

export interface LinkTaskToCommitInput {
  task_id: string;
  sha: string;
  message?: string;
  author?: string;
  files_changed?: string[];
  committed_at?: string;
}

/** Link a git commit SHA to a task. Upserts on same task+sha. */
export function linkTaskToCommit(input: LinkTaskToCommitInput, db?: Database): TaskCommit {
  const d = db || getDatabase();

  const existing = d.query("SELECT * FROM task_commits WHERE task_id = ? AND sha = ?").get(input.task_id, input.sha) as TaskCommitRow | null;

  if (existing) {
    // Update with any new info
    d.run(
      "UPDATE task_commits SET message = COALESCE(?, message), author = COALESCE(?, author), files_changed = COALESCE(?, files_changed), committed_at = COALESCE(?, committed_at) WHERE id = ?",
      [input.message ?? null, input.author ?? null, input.files_changed ? JSON.stringify(input.files_changed) : null, input.committed_at ?? null, existing.id],
    );
    return rowToCommit(d.query("SELECT * FROM task_commits WHERE id = ?").get(existing.id) as TaskCommitRow);
  }

  const id = uuid();
  d.run(
    "INSERT INTO task_commits (id, task_id, sha, message, author, files_changed, committed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, input.task_id, input.sha, input.message ?? null, input.author ?? null, input.files_changed ? JSON.stringify(input.files_changed) : null, input.committed_at ?? null, now()],
  );
  return rowToCommit(d.query("SELECT * FROM task_commits WHERE id = ?").get(id) as TaskCommitRow);
}

/** Get all commits linked to a task. */
export function getTaskCommits(taskId: string, db?: Database): TaskCommit[] {
  const d = db || getDatabase();
  return (d.query("SELECT * FROM task_commits WHERE task_id = ? ORDER BY committed_at DESC, created_at DESC").all(taskId) as TaskCommitRow[]).map(rowToCommit);
}

/** Find which task a commit SHA is linked to. */
export function findTaskByCommit(sha: string, db?: Database): { task_id: string; commit: TaskCommit } | null {
  const d = db || getDatabase();
  // Support prefix matching (first 7+ chars)
  const row = d.query("SELECT * FROM task_commits WHERE sha = ? OR sha LIKE ? LIMIT 1").get(sha, `${sha}%`) as TaskCommitRow | null;
  if (!row) return null;
  return { task_id: row.task_id, commit: rowToCommit(row) };
}

/** Remove a commit link. */
export function unlinkTaskCommit(taskId: string, sha: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM task_commits WHERE task_id = ? AND (sha = ? OR sha LIKE ?)", [taskId, sha, `${sha}%`]).changes > 0;
}
