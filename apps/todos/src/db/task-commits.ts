import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";

export interface CiSnapshot {
  status: string;
  provider?: string;
  run_url?: string;
  checks?: Record<string, string>;
  captured_at?: string;
  [key: string]: unknown;
}

export interface TaskCommit {
  id: string;
  task_id: string;
  sha: string;
  message: string | null;
  author: string | null;
  files_changed: string[] | null;
  committed_at: string | null;
  branch: string | null;
  pr_url: string | null;
  pr_number: number | null;
  pr_state: string | null;
  ci_snapshot: CiSnapshot | null;
  release_tag: string | null;
  repo_path: string | null;
  traceability: Record<string, unknown>;
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
  branch: string | null;
  pr_url: string | null;
  pr_number: number | null;
  pr_state: string | null;
  ci_snapshot: string | null;
  release_tag: string | null;
  repo_path: string | null;
  traceability: string | null;
  created_at: string;
}

function rowToCommit(row: TaskCommitRow): TaskCommit {
  return {
    ...row,
    files_changed: row.files_changed ? JSON.parse(row.files_changed) : null,
    ci_snapshot: row.ci_snapshot ? JSON.parse(row.ci_snapshot) : null,
    traceability: row.traceability ? JSON.parse(row.traceability) : {},
  };
}

export interface LinkTaskToCommitInput {
  task_id: string;
  sha: string;
  message?: string;
  author?: string;
  files_changed?: string[];
  committed_at?: string;
  branch?: string;
  pr_url?: string;
  pr_number?: number;
  pr_state?: string;
  ci_snapshot?: CiSnapshot;
  release_tag?: string;
  repo_path?: string;
  traceability?: Record<string, unknown>;
}

/** Link a git commit SHA to a task. Upserts on same task+sha. */
export function linkTaskToCommit(input: LinkTaskToCommitInput, db?: Database): TaskCommit {
  const d = db || getDatabase();

  const existing = d.query("SELECT * FROM task_commits WHERE task_id = ? AND sha = ?").get(input.task_id, input.sha) as TaskCommitRow | null;

  const ciJson = input.ci_snapshot ? JSON.stringify(input.ci_snapshot) : null;
  const traceJson = input.traceability ? JSON.stringify(input.traceability) : null;

  if (existing) {
    d.run(
      `UPDATE task_commits SET
        message = COALESCE(?, message),
        author = COALESCE(?, author),
        files_changed = COALESCE(?, files_changed),
        committed_at = COALESCE(?, committed_at),
        branch = COALESCE(?, branch),
        pr_url = COALESCE(?, pr_url),
        pr_number = COALESCE(?, pr_number),
        pr_state = COALESCE(?, pr_state),
        ci_snapshot = COALESCE(?, ci_snapshot),
        release_tag = COALESCE(?, release_tag),
        repo_path = COALESCE(?, repo_path),
        traceability = COALESCE(?, traceability)
       WHERE id = ?`,
      [
        input.message ?? null,
        input.author ?? null,
        input.files_changed ? JSON.stringify(input.files_changed) : null,
        input.committed_at ?? null,
        input.branch ?? null,
        input.pr_url ?? null,
        input.pr_number ?? null,
        input.pr_state ?? null,
        ciJson,
        input.release_tag ?? null,
        input.repo_path ?? null,
        traceJson,
        existing.id,
      ],
    );
    return rowToCommit(d.query("SELECT * FROM task_commits WHERE id = ?").get(existing.id) as TaskCommitRow);
  }

  const id = uuid();
  d.run(
    `INSERT INTO task_commits (
      id, task_id, sha, message, author, files_changed, committed_at,
      branch, pr_url, pr_number, pr_state, ci_snapshot, release_tag, repo_path, traceability, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.task_id,
      input.sha,
      input.message ?? null,
      input.author ?? null,
      input.files_changed ? JSON.stringify(input.files_changed) : null,
      input.committed_at ?? null,
      input.branch ?? null,
      input.pr_url ?? null,
      input.pr_number ?? null,
      input.pr_state ?? null,
      ciJson,
      input.release_tag ?? null,
      input.repo_path ?? null,
      traceJson ?? "{}",
      now(),
    ],
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
  const row = d.query("SELECT * FROM task_commits WHERE sha = ? OR sha LIKE ? LIMIT 1").get(sha, `${sha}%`) as TaskCommitRow | null;
  if (!row) return null;
  return { task_id: row.task_id, commit: rowToCommit(row) };
}

/** Remove a commit link. */
export function unlinkTaskCommit(taskId: string, sha: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM task_commits WHERE task_id = ? AND (sha = ? OR sha LIKE ?)", [taskId, sha, `${sha}%`]).changes > 0;
}

export interface TaskTraceabilityReport {
  task_id: string;
  commits: TaskCommit[];
  branches: string[];
  pull_requests: Array<{ url: string; number: number | null; state: string | null }>;
  release_tags: string[];
  ci_statuses: CiSnapshot[];
}

/** Aggregate traceability view for a task. */
export function getTaskTraceability(taskId: string, db?: Database): TaskTraceabilityReport {
  const commits = getTaskCommits(taskId, db);
  const branches = [...new Set(commits.map((c) => c.branch).filter(Boolean))] as string[];
  const pullRequests = commits
    .filter((c) => c.pr_url)
    .map((c) => ({ url: c.pr_url!, number: c.pr_number, state: c.pr_state }));
  const releaseTags = [...new Set(commits.map((c) => c.release_tag).filter(Boolean))] as string[];
  const ciStatuses = commits.map((c) => c.ci_snapshot).filter(Boolean) as CiSnapshot[];

  return {
    task_id: taskId,
    commits,
    branches,
    pull_requests: pullRequests,
    release_tags: releaseTags,
    ci_statuses: ciStatuses,
  };
}
