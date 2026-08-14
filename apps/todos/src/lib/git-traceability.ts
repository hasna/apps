/**
 * Git traceability — capture branch, commit, changed files, PR URLs, CI snapshots locally.
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { Database } from "bun:sqlite";
import {
  linkTaskToCommit,
  getTaskTraceability,
  type CiSnapshot,
  type TaskCommit,
  type TaskTraceabilityReport,
} from "../db/task-commits.js";

export const GIT_TRACEABILITY_SCHEMA_VERSION = "todos.git_traceability.v1";

export interface GitCommitInfo {
  sha: string;
  message: string;
  author: string;
  committed_at: string;
  files_changed: string[];
  branch: string | null;
  repo_path: string | null;
}

export interface LinkGitTraceInput {
  task_id: string;
  sha?: string;
  branch?: string;
  pr_url?: string;
  pr_number?: number;
  pr_state?: string;
  release_tag?: string;
  ci_snapshot_path?: string;
  ci_snapshot?: CiSnapshot;
  cwd?: string;
  traceability?: Record<string, unknown>;
}

function runGit(args: string[], cwd: string): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) return null;
  return (result.stdout || "").trim() || null;
}

export function resolveGitRoot(cwd?: string): string | null {
  const dir = cwd || process.cwd();
  return runGit(["rev-parse", "--show-toplevel"], dir);
}

export function getCurrentBranch(cwd?: string): string | null {
  const dir = cwd || process.cwd();
  return runGit(["rev-parse", "--abbrev-ref", "HEAD"], dir);
}

export function getHeadSha(cwd?: string): string | null {
  const dir = cwd || process.cwd();
  return runGit(["rev-parse", "HEAD"], dir);
}

export function inspectGitCommit(sha: string, cwd?: string): GitCommitInfo | null {
  const dir = cwd || process.cwd();
  const format = "%H|%s|%an|%aI";
  const line = runGit(["show", "-s", `--format=${format}`, sha], dir);
  if (!line) return null;

  const [fullSha, message, author, committedAt] = line.split("|");
  if (!fullSha) return null;

  const filesRaw = runGit(["show", "--name-only", "--pretty=format:", sha], dir);
  const files = filesRaw ? filesRaw.split("\n").map((f) => f.trim()).filter(Boolean) : [];

  return {
    sha: fullSha,
    message: message ?? "",
    author: author ?? "",
    committed_at: committedAt ?? "",
    files_changed: files,
    branch: getCurrentBranch(dir),
    repo_path: resolveGitRoot(dir),
  };
}

export function loadCiSnapshot(path?: string): CiSnapshot | null {
  const target = path ? resolve(path) : resolve(process.cwd(), ".todos", "ci-snapshot.json");
  if (!existsSync(target)) return null;
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8")) as CiSnapshot;
    return { ...parsed, captured_at: parsed.captured_at ?? new Date().toISOString() };
  } catch {
    return null;
  }
}

/** Try gh CLI for PR info on current branch (local gh auth, no hosted todos API). */
export function detectPrForBranch(branch: string, cwd?: string): { pr_url: string; pr_number: number; pr_state: string } | null {
  const dir = cwd || process.cwd();
  const result = spawnSync(
    "gh",
    ["pr", "view", branch, "--json", "url,number,state"],
    { cwd: dir, encoding: "utf8" },
  );
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as { url: string; number: number; state: string };
    if (!parsed.url) return null;
    return { pr_url: parsed.url, pr_number: parsed.number, pr_state: parsed.state };
  } catch {
    return null;
  }
}

export function linkTaskGitTrace(input: LinkGitTraceInput, db?: Database): TaskCommit {
  const cwd = input.cwd || process.cwd();
  const sha = input.sha || getHeadSha(cwd);
  if (!sha) throw new Error("Could not resolve git commit SHA");

  const info = inspectGitCommit(sha, cwd);
  if (!info) throw new Error(`Could not inspect git commit: ${sha}`);

  const branch = input.branch ?? info.branch ?? undefined;
  let prUrl = input.pr_url;
  let prNumber = input.pr_number;
  let prState = input.pr_state;

  if (!prUrl && branch) {
    const detected = detectPrForBranch(branch, cwd);
    if (detected) {
      prUrl = detected.pr_url;
      prNumber = detected.pr_number;
      prState = detected.pr_state;
    }
  }

  const ciSnapshot = input.ci_snapshot ?? (input.ci_snapshot_path ? loadCiSnapshot(input.ci_snapshot_path) : loadCiSnapshot()) ?? undefined;

  return linkTaskToCommit({
    task_id: input.task_id,
    sha: info.sha,
    message: info.message,
    author: info.author,
    files_changed: info.files_changed,
    committed_at: info.committed_at,
    branch,
    pr_url: prUrl,
    pr_number: prNumber,
    pr_state: prState,
    release_tag: input.release_tag,
    repo_path: info.repo_path ?? undefined,
    ci_snapshot: ciSnapshot ?? undefined,
    traceability: {
      schema_version: GIT_TRACEABILITY_SCHEMA_VERSION,
      ...(input.traceability ?? {}),
    },
  }, db);
}

export function formatTraceabilityReport(report: TaskTraceabilityReport): string {
  const lines: string[] = [
    `Task: ${report.task_id}`,
    `Commits: ${report.commits.length}`,
  ];

  if (report.branches.length) lines.push(`Branches: ${report.branches.join(", ")}`);
  if (report.release_tags.length) lines.push(`Release tags: ${report.release_tags.join(", ")}`);

  for (const pr of report.pull_requests) {
    lines.push(`PR: ${pr.url}${pr.state ? ` (${pr.state})` : ""}`);
  }

  for (const commit of report.commits) {
    lines.push("");
    lines.push(`${commit.sha.slice(0, 7)} — ${commit.message ?? "(no message)"}`);
    if (commit.branch) lines.push(`  branch: ${commit.branch}`);
    if (commit.pr_url) lines.push(`  pr: ${commit.pr_url}`);
    if (commit.files_changed?.length) {
      lines.push(`  files: ${commit.files_changed.slice(0, 8).join(", ")}${commit.files_changed.length > 8 ? "…" : ""}`);
    }
    if (commit.ci_snapshot) {
      lines.push(`  ci: ${commit.ci_snapshot.status}${commit.ci_snapshot.run_url ? ` — ${commit.ci_snapshot.run_url}` : ""}`);
    }
    if (commit.release_tag) lines.push(`  release: ${commit.release_tag}`);
  }

  return lines.join("\n");
}

export { getTaskTraceability };
