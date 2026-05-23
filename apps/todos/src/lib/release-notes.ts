/**
 * Local release notes and changelog generation from git commits and completed tasks.
 * Keep a Changelog format — no hosted API required.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { resolveGitRoot } from "./git-traceability.js";

export const RELEASE_NOTES_SCHEMA = "todos.release_notes.v1";

export const CHANGELOG_CATEGORIES = [
  "Added",
  "Changed",
  "Fixed",
  "Removed",
  "Deprecated",
  "Security",
  "Performance",
  "Tasks",
] as const;

export type ChangelogCategory = (typeof CHANGELOG_CATEGORIES)[number];

export interface GitCommitEntry {
  sha: string;
  short_sha: string;
  message: string;
  author: string;
  committed_at: string;
  category: ChangelogCategory;
  scope?: string;
  description: string;
  breaking: boolean;
}

export interface TaskReleaseEntry {
  id: string;
  short_id: string | null;
  title: string;
  completed_at: string | null;
  commit_hash: string | null;
  notes: string | null;
  assigned_to: string | null;
}

export interface ReleaseNotesReport {
  schema_version: typeof RELEASE_NOTES_SCHEMA;
  version: string;
  generated_at: string;
  since_ref: string;
  since_date: string | null;
  until_ref: string | null;
  sections: Record<ChangelogCategory, string[]>;
  commits: GitCommitEntry[];
  tasks: TaskReleaseEntry[];
  sources: {
    commits: number;
    tasks: number;
    task_only: number;
  };
}

export interface BuildReleaseNotesInput {
  version?: string;
  since?: string;
  until?: string;
  project_id?: string;
  cwd?: string;
  include_commits?: boolean;
  include_tasks?: boolean;
  db?: Database;
}

const DEFAULT_CHANGELOG_HEADER = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;

const COMMIT_TYPE_TO_CATEGORY: Record<string, ChangelogCategory> = {
  feat: "Added",
  feature: "Added",
  add: "Added",
  fix: "Fixed",
  bugfix: "Fixed",
  perf: "Performance",
  performance: "Performance",
  security: "Security",
  sec: "Security",
  remove: "Removed",
  delete: "Removed",
  deprecate: "Deprecated",
  refactor: "Changed",
  change: "Changed",
  chore: "Changed",
  docs: "Changed",
  style: "Changed",
  test: "Changed",
  build: "Changed",
  ci: "Changed",
  revert: "Fixed",
};

function runGit(args: string[], cwd: string): string | null {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) return null;
  return new TextDecoder().decode(result.stdout).trim() || null;
}

function readPackageVersion(cwd: string): string {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return "0.0.0";
  try {
    const pkg = JSON.parse(readFileSync(path, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function parseConventionalCommit(message: string): {
  type: string;
  scope?: string;
  description: string;
  breaking: boolean;
} {
  const firstLine = message.split("\n")[0]!.trim();
  const breaking = firstLine.includes("!:") || /^BREAKING CHANGE:/m.test(message);
  const match = firstLine.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
  if (!match) {
    return { type: "other", description: firstLine, breaking };
  }
  return {
    type: match[1]!.toLowerCase(),
    scope: match[2],
    description: match[3]!.trim(),
    breaking,
  };
}

export function mapCommitTypeToCategory(type: string, breaking: boolean): ChangelogCategory {
  if (breaking) return "Changed";
  return COMMIT_TYPE_TO_CATEGORY[type] ?? "Changed";
}

export function getLatestGitTag(cwd: string): string | null {
  return runGit(["describe", "--tags", "--abbrev=0"], cwd);
}

export function resolveSinceRef(since: string | undefined, cwd: string): { ref: string; date: string | null } {
  if (since) {
    if (/^\d{4}-\d{2}-\d{2}/.test(since)) {
      return { ref: since, date: since.slice(0, 10) };
    }
    const tagDate = runGit(["log", "-1", "--format=%aI", since], cwd);
    return { ref: since, date: tagDate?.slice(0, 10) ?? null };
  }

  const tag = getLatestGitTag(cwd);
  if (tag) {
    const tagDate = runGit(["log", "-1", "--format=%aI", tag], cwd);
    return { ref: tag, date: tagDate?.slice(0, 10) ?? null };
  }

  return { ref: "", date: null };
}

export function getGitLogSince(
  sinceRef: string,
  cwd: string,
  untilRef?: string,
): GitCommitEntry[] {
  if (!sinceRef) return [];
  const root = resolveGitRoot(cwd) ?? cwd;
  const args = ["log", "--pretty=format:%H|%s|%an|%aI", "--no-merges"];

  if (/^\d{4}-\d{2}-\d{2}/.test(sinceRef)) {
    args.push(`--since=${sinceRef}`);
  } else {
    args.push(`${sinceRef}..${untilRef ?? "HEAD"}`);
  }

  const output = runGit(args, root);
  if (!output) return [];

  return output.split("\n").filter(Boolean).map((line) => {
    const [sha, message, author, committedAt] = line.split("|");
    const parsed = parseConventionalCommit(message ?? "");
    const category = mapCommitTypeToCategory(parsed.type, parsed.breaking);
    return {
      sha: sha!,
      short_sha: sha!.slice(0, 7),
      message: message ?? "",
      author: author ?? "",
      committed_at: committedAt ?? "",
      category,
      scope: parsed.scope,
      description: parsed.description,
      breaking: parsed.breaking,
    };
  });
}

function taskEvidence(task: { metadata: unknown }): { commit_hash: string | null; notes: string | null } {
  const meta = (task.metadata ?? {}) as Record<string, unknown>;
  const evidence = meta._evidence as { commit_hash?: string; notes?: string } | undefined;
  return {
    commit_hash: evidence?.commit_hash ?? null,
    notes: evidence?.notes ?? null,
  };
}

export function getCompletedTasksForRelease(
  opts: { since?: string; project_id?: string },
  db?: Database,
): TaskReleaseEntry[] {
  const d = db ?? getDatabase();
  const conditions = ["status = 'completed'"];
  const params: unknown[] = [];

  if (opts.since) {
    conditions.push("completed_at >= ?");
    params.push(opts.since.includes("T") ? opts.since : `${opts.since}T00:00:00.000Z`);
  }
  if (opts.project_id) {
    conditions.push("project_id = ?");
    params.push(opts.project_id);
  }

  const rows = d.query(
    `SELECT id, short_id, title, completed_at, metadata, assigned_to
     FROM tasks WHERE ${conditions.join(" AND ")}
     ORDER BY completed_at DESC`,
  ).all(...params) as Array<{
    id: string;
    short_id: string | null;
    title: string;
    completed_at: string | null;
    metadata: string | null;
    assigned_to: string | null;
  }>;

  return rows.map((row) => {
    const metadata = row.metadata ? JSON.parse(row.metadata) : {};
    const evidence = taskEvidence({ metadata });
    return {
      id: row.id,
      short_id: row.short_id,
      title: row.title,
      completed_at: row.completed_at,
      commit_hash: evidence.commit_hash,
      notes: evidence.notes,
      assigned_to: row.assigned_to,
    };
  });
}

function stripShortIdPrefix(title: string, shortId: string | null): string {
  if (!shortId) return title;
  const prefix = `${shortId}: `;
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}

function formatCommitLine(entry: GitCommitEntry, task?: TaskReleaseEntry): string {
  const prefix = entry.breaking ? "BREAKING: " : "";
  const scope = entry.scope ? `(${entry.scope}) ` : "";
  const taskRef = task?.short_id ? ` [${task.short_id}]` : "";
  const notes = task?.notes ? ` — ${task.notes}` : "";
  return `- ${prefix}${scope}${entry.description}${taskRef}${notes} (${entry.short_sha})`;
}

function formatTaskLine(task: TaskReleaseEntry): string {
  const title = stripShortIdPrefix(task.title, task.short_id);
  const sid = task.short_id ? `[${task.short_id}] ` : "";
  const commit = task.commit_hash ? ` (${task.commit_hash.slice(0, 7)})` : "";
  const notes = task.notes ? ` — ${task.notes}` : "";
  return `- ${sid}${title}${notes}${commit}`;
}

function emptySections(): Record<ChangelogCategory, string[]> {
  return {
    Added: [],
    Changed: [],
    Fixed: [],
    Removed: [],
    Deprecated: [],
    Security: [],
    Performance: [],
    Tasks: [],
  };
}

export function buildReleaseNotes(input: BuildReleaseNotesInput = {}): ReleaseNotesReport {
  const cwd = input.cwd ?? process.cwd();
  const root = resolveGitRoot(cwd) ?? cwd;
  const db = input.db ?? getDatabase();
  const version = input.version ?? readPackageVersion(root);
  const sinceInfo = resolveSinceRef(input.since, root);
  const includeCommits = input.include_commits !== false;
  const includeTasks = input.include_tasks !== false;

  const commits = includeCommits && sinceInfo.ref
    ? getGitLogSince(sinceInfo.ref, root, input.until)
    : [];

  const taskSince = sinceInfo.date ?? (input.since && /^\d{4}-\d{2}-\d{2}/.test(input.since) ? input.since.slice(0, 10) : undefined);
  const tasks = includeTasks
    ? getCompletedTasksForRelease({ since: taskSince, project_id: input.project_id }, db)
    : [];

  const tasksByCommit = new Map<string, TaskReleaseEntry>();
  for (const task of tasks) {
    if (task.commit_hash) {
      const key = task.commit_hash.slice(0, 7);
      tasksByCommit.set(key, task);
      tasksByCommit.set(task.commit_hash, task);
    }
  }

  const sections = emptySections();
  const linkedTaskIds = new Set<string>();

  for (const commit of commits) {
    const task = tasksByCommit.get(commit.short_sha) ?? tasksByCommit.get(commit.sha);
    if (task) linkedTaskIds.add(task.id);
    sections[commit.category].push(formatCommitLine(commit, task));
  }

  let taskOnly = 0;
  for (const task of tasks) {
    if (linkedTaskIds.has(task.id)) continue;
    sections.Tasks.push(formatTaskLine(task));
    taskOnly += 1;
  }

  return {
    schema_version: RELEASE_NOTES_SCHEMA,
    version,
    generated_at: new Date().toISOString(),
    since_ref: sinceInfo.ref,
    since_date: sinceInfo.date,
    until_ref: input.until ?? null,
    sections,
    commits,
    tasks,
    sources: {
      commits: commits.length,
      tasks: tasks.length,
      task_only: taskOnly,
    },
  };
}

export function formatReleaseNotesMarkdown(report: ReleaseNotesReport): string {
  const date = report.generated_at.slice(0, 10);
  const lines = [`## [${report.version}] - ${date}`, ""];

  for (const category of CHANGELOG_CATEGORIES) {
    const items = report.sections[category];
    if (!items.length) continue;
    lines.push(`### ${category}`);
    lines.push(...items);
    lines.push("");
  }

  if (lines.at(-1) === "") lines.pop();
  return lines.join("\n");
}

export function formatChangelogSection(report: ReleaseNotesReport): string {
  return formatReleaseNotesMarkdown(report);
}

export interface UpdateChangelogInput {
  path?: string;
  report: ReleaseNotesReport;
  dry_run?: boolean;
}

export function updateChangelog(input: UpdateChangelogInput): { path: string; written: boolean; preview: string } {
  const path = input.path ?? join(process.cwd(), "CHANGELOG.md");
  const section = formatChangelogSection(input.report);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : DEFAULT_CHANGELOG_HEADER;

  const marker = "\n## [";
  const insertAt = existing.indexOf(marker);
  const next = insertAt === -1
    ? `${existing.trimEnd()}\n\n${section}\n`
    : `${existing.slice(0, insertAt)}\n${section}\n${existing.slice(insertAt)}`;

  if (!input.dry_run) {
    writeFileSync(path, next);
  }

  return { path, written: !input.dry_run, preview: section };
}

export function getReleaseNotesDocs(): string {
  return `# Release notes and changelog generation

Generate Keep a Changelog sections from local git history and completed todos tasks.

## CLI

\`\`\`bash
# Preview release notes since latest tag
todos release-notes generate

# Specific version and since ref
todos release-notes generate --version 0.11.31 --since v0.11.30

# Write to CHANGELOG.md
todos release-notes generate --write-changelog

# Tasks only (no git)
todos release-notes generate --no-commits --since 2026-05-01
\`\`\`

## Sources

- **Git commits** — conventional commit types map to Added/Fixed/Changed/etc.
- **Completed tasks** — from local SQLite; merges via \`commit_hash\` evidence on \`todos done\`

## MCP tools

- \`generate_release_notes\`
- \`format_release_notes_markdown\`
- \`update_changelog\` (supports \`dry_run\`)
`;
}
