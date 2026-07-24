import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";
import { sanitizePreWriteText, sanitizePreWriteValue } from "../lib/prewrite-secrets.js";

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

export interface TaskGitRef {
  id: string;
  task_id: string;
  ref_type: "branch" | "pull_request";
  name: string;
  url: string | null;
  provider: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TaskVerification {
  id: string;
  task_id: string;
  command: string;
  status: "passed" | "failed" | "unknown";
  output_summary: string | null;
  artifact_path: string | null;
  agent_id: string | null;
  run_at: string;
  created_at: string;
}

export interface TaskTraceabilityReport {
  task_id: string;
  commits: TaskCommit[];
  git_refs: TaskGitRef[];
  verifications: TaskVerification[];
  branches: string[];
  release_tags: string[];
  pull_requests: Array<{ url: string; state: string | null; number: number | null }>;
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

interface TaskGitRefRow {
  id: string;
  task_id: string;
  ref_type: "branch" | "pull_request";
  name: string;
  url: string | null;
  provider: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskVerificationRow {
  id: string;
  task_id: string;
  command: string;
  status: "passed" | "failed" | "unknown";
  output_summary: string | null;
  artifact_path: string | null;
  agent_id: string | null;
  run_at: string;
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

function rowToGitRef(row: TaskGitRefRow): TaskGitRef {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  };
}

function rowToVerification(row: TaskVerificationRow): TaskVerification {
  return row;
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

  const ciJson = input.ci_snapshot ? JSON.stringify(sanitizePreWriteValue(input.ci_snapshot, "commit.ci_snapshot")) : null;
  const traceJson = input.traceability ? JSON.stringify(sanitizePreWriteValue(input.traceability, "commit.traceability")) : null;
  const message = input.message ? sanitizePreWriteText(input.message, "commit.message") : null;
  const author = input.author ? sanitizePreWriteText(input.author, "commit.author") : null;
  const filesChanged = input.files_changed ? JSON.stringify(sanitizePreWriteValue(input.files_changed, "commit.files_changed")) : null;
  const branch = input.branch ? sanitizePreWriteText(input.branch, "commit.branch") : null;
  const prUrl = input.pr_url ? sanitizePreWriteText(input.pr_url, "commit.pr_url") : null;
  const prState = input.pr_state ? sanitizePreWriteText(input.pr_state, "commit.pr_state") : null;
  const releaseTag = input.release_tag ? sanitizePreWriteText(input.release_tag, "commit.release_tag") : null;
  const repoPath = input.repo_path ? sanitizePreWriteText(input.repo_path, "commit.repo_path") : null;

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
        message,
        author,
        filesChanged,
        input.committed_at ?? null,
        branch,
        prUrl,
        input.pr_number ?? null,
        prState,
        ciJson,
        releaseTag,
        repoPath,
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
      message,
      author,
      filesChanged,
      input.committed_at ?? null,
      branch,
      prUrl,
      input.pr_number ?? null,
      prState,
      ciJson,
      releaseTag,
      repoPath,
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

export interface LinkTaskGitRefInput {
  task_id: string;
  ref_type: "branch" | "pull_request";
  name: string;
  url?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}

/** Link a local branch or pull request URL/number to a task. Upserts on task+type+name. */
export function linkTaskGitRef(input: LinkTaskGitRefInput, db?: Database): TaskGitRef {
  const d = db || getDatabase();
  const timestamp = now();
  const metadata = JSON.stringify(sanitizePreWriteValue(input.metadata || {}, "git_ref.metadata"));
  const name = sanitizePreWriteText(input.name, "git_ref.name");
  const url = input.url ? sanitizePreWriteText(input.url, "git_ref.url") : null;
  const provider = input.provider ? sanitizePreWriteText(input.provider, "git_ref.provider") : null;
  const existing = d
    .query("SELECT * FROM task_git_refs WHERE task_id = ? AND ref_type = ? AND name = ?")
    .get(input.task_id, input.ref_type, name) as TaskGitRefRow | null;

  if (existing) {
    d.run(
      "UPDATE task_git_refs SET url = COALESCE(?, url), provider = COALESCE(?, provider), metadata = ?, updated_at = ? WHERE id = ?",
      [url, provider, metadata, timestamp, existing.id],
    );
    return rowToGitRef(d.query("SELECT * FROM task_git_refs WHERE id = ?").get(existing.id) as TaskGitRefRow);
  }

  const id = uuid();
  d.run(
    "INSERT INTO task_git_refs (id, task_id, ref_type, name, url, provider, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, input.task_id, input.ref_type, name, url, provider, metadata, timestamp, timestamp],
  );
  return rowToGitRef(d.query("SELECT * FROM task_git_refs WHERE id = ?").get(id) as TaskGitRefRow);
}

export function getTaskGitRefs(taskId: string, db?: Database): TaskGitRef[] {
  const d = db || getDatabase();
  return (d
    .query("SELECT * FROM task_git_refs WHERE task_id = ? ORDER BY ref_type, updated_at DESC")
    .all(taskId) as TaskGitRefRow[]).map(rowToGitRef);
}

export function findTasksByGitRef(ref: string, db?: Database): TaskGitRef[] {
  const d = db || getDatabase();
  return (d
    .query("SELECT * FROM task_git_refs WHERE name = ? OR url = ? OR name LIKE ? OR url LIKE ? ORDER BY updated_at DESC")
    .all(ref, ref, `%${ref}%`, `%${ref}%`) as TaskGitRefRow[]).map(rowToGitRef);
}

export interface AddTaskVerificationInput {
  task_id: string;
  command: string;
  status?: "passed" | "failed" | "unknown";
  output_summary?: string;
  artifact_path?: string;
  agent_id?: string;
  run_at?: string;
}

export function addTaskVerification(input: AddTaskVerificationInput, db?: Database): TaskVerification {
  const d = db || getDatabase();
  const id = uuid();
  const runAt = input.run_at || now();
  const command = sanitizePreWriteText(input.command, "verification.command");
  const outputSummary = input.output_summary ? sanitizePreWriteText(input.output_summary, "verification.output_summary") : null;
  const artifactPath = input.artifact_path ? sanitizePreWriteText(input.artifact_path, "verification.artifact_path") : null;
  d.run(
    "INSERT INTO task_verifications (id, task_id, command, status, output_summary, artifact_path, agent_id, run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      input.task_id,
      command,
      input.status || "unknown",
      outputSummary,
      artifactPath,
      input.agent_id ?? null,
      runAt,
      now(),
    ],
  );
  return rowToVerification(d.query("SELECT * FROM task_verifications WHERE id = ?").get(id) as TaskVerificationRow);
}

export function getTaskVerifications(taskId: string, db?: Database): TaskVerification[] {
  const d = db || getDatabase();
  return (d
    .query("SELECT * FROM task_verifications WHERE task_id = ? ORDER BY run_at DESC, created_at DESC")
    .all(taskId) as TaskVerificationRow[]).map(rowToVerification);
}

export function getTaskTraceability(taskId: string, db?: Database): TaskTraceabilityReport {
  const d = db || getDatabase();
  const commits = getTaskCommits(taskId, d);
  const gitRefs = getTaskGitRefs(taskId, d);
  return {
    task_id: taskId,
    commits,
    git_refs: gitRefs,
    verifications: getTaskVerifications(taskId, d),
    branches: Array.from(new Set([
      ...commits.map((commit) => commit.branch).filter((branch): branch is string => Boolean(branch)),
      ...gitRefs.filter((ref) => ref.ref_type === "branch").map((ref) => ref.name),
    ])).sort(),
    release_tags: Array.from(new Set(commits.map((commit) => commit.release_tag).filter((tag): tag is string => Boolean(tag)))).sort(),
    pull_requests: commits
      .filter((commit) => commit.pr_url)
      .map((commit) => ({ url: commit.pr_url!, state: commit.pr_state, number: commit.pr_number })),
  };
}
