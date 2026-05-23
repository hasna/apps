/**
 * Local mention resolver — @file, @symbol, @task, @plan, @run, git refs, URLs.
 * Resolves references in task text into stable local links and redacted snippets.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, basename } from "node:path";
import type { Database } from "bun:sqlite";
import { getDatabase, resolvePartialId } from "../db/database.js";
import { getTask } from "../db/tasks.js";
import { resolvePlanRef } from "./plan-execution.js";
import { getRunRecord } from "./run-records.js";
import { inspectGitCommit, getCurrentBranch, resolveGitRoot } from "./git-traceability.js";
import { redactText } from "./secret-redaction.js";

export const MENTION_RESOLVER_SCHEMA = "todos.mention_resolver.v1";

export const MENTION_KINDS = [
  "file",
  "symbol",
  "task",
  "plan",
  "run",
  "branch",
  "commit",
  "pr",
  "url",
] as const;

export type MentionKind = (typeof MENTION_KINDS)[number];
export type MentionStatus = "resolved" | "missing" | "ambiguous";

export interface ParsedMention {
  raw: string;
  kind: MentionKind;
  target: string;
  start: number;
  end: number;
}

export interface ResolvedMention {
  schema_version: typeof MENTION_RESOLVER_SCHEMA;
  raw: string;
  kind: MentionKind;
  target: string;
  status: MentionStatus;
  link?: string;
  snippet?: string;
  context?: Record<string, unknown>;
  candidates?: string[];
  redacted?: boolean;
}

export interface MentionResolutionResult {
  schema_version: typeof MENTION_RESOLVER_SCHEMA;
  mentions: ResolvedMention[];
  redacted_text?: string;
}

export interface ResolveMentionOptions {
  cwd?: string;
  db?: Database;
  snippet_lines?: number;
  redact?: boolean;
}

const EXPLICIT_MENTION_RE = /@(file|symbol|task|plan|run|branch|commit|pr):([^\s`)\]}>,]+)/g;
const URL_RE = /https?:\/\/[^\s`)\]}>,]+/g;
const GITHUB_PR_RE = /https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/g;
const TASK_SHORT_ID_RE = /@task:([A-Z][A-Z0-9]*-\d+)/g;

const SYMBOL_DEF_RES = [
  /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
  /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/g,
  /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g,
];

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".rb",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".takumi", "coverage",
]);

function dedupeMentions(mentions: ParsedMention[]): ParsedMention[] {
  const seen = new Set<string>();
  const out: ParsedMention[] = [];
  for (const m of mentions.sort((a, b) => a.start - b.start)) {
    const key = `${m.start}:${m.end}:${m.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function pushMatch(
  mentions: ParsedMention[],
  raw: string,
  kind: MentionKind,
  target: string,
  start: number,
): void {
  mentions.push({ raw, kind, target, start, end: start + raw.length });
}

export function parseMentions(text: string): ParsedMention[] {
  const mentions: ParsedMention[] = [];

  for (const match of text.matchAll(EXPLICIT_MENTION_RE)) {
    const full = match[0]!;
    const kind = match[1]!.toLowerCase() as MentionKind;
    const target = match[2]!;
    pushMatch(mentions, full, kind, target, match.index ?? 0);
  }

  for (const match of text.matchAll(GITHUB_PR_RE)) {
    const full = match[0]!;
    pushMatch(mentions, full, "pr", match[1]!, match.index ?? 0);
  }

  for (const match of text.matchAll(URL_RE)) {
    const full = match[0]!;
    if (mentions.some((m) => m.start <= (match.index ?? 0) && m.end >= (match.index ?? 0) + full.length)) {
      continue;
    }
    if (/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(full)) continue;
    pushMatch(mentions, full, "url", full, match.index ?? 0);
  }

  for (const match of text.matchAll(TASK_SHORT_ID_RE)) {
    const full = match[0]!;
    if (mentions.some((m) => m.raw === full)) continue;
    pushMatch(mentions, full, "task", match[1]!, match.index ?? 0);
  }

  return dedupeMentions(mentions);
}

function resolveRunId(partialId: string, db: Database): string | null {
  if (partialId.length >= 36) {
    const row = db.query("SELECT id FROM run_records WHERE id = ?").get(partialId) as { id: string } | null;
    return row?.id ?? null;
  }
  const rows = db.query("SELECT id FROM run_records WHERE id LIKE ?").all(`${partialId}%`) as { id: string }[];
  if (rows.length === 1) return rows[0]!.id;
  return null;
}

function parseFileTarget(target: string): { path: string; line?: number } {
  const hashLine = target.match(/^(.+?)#L?(\d+)$/);
  if (hashLine) return { path: hashLine[1]!, line: parseInt(hashLine[2]!, 10) };
  const colonLine = target.match(/^(.+?):(\d+)$/);
  if (colonLine && !colonLine[1]!.includes("://")) {
    const ext = colonLine[1]!.slice(colonLine[1]!.lastIndexOf("."));
    if (CODE_EXTENSIONS.has(ext)) {
      return { path: colonLine[1]!, line: parseInt(colonLine[2]!, 10) };
    }
  }
  return { path: target };
}

function findFilesByBasename(name: string, cwd: string): string[] {
  const glob = new Bun.Glob(`**/${name}`);
  const matches: string[] = [];
  for (const entry of glob.scanSync({ cwd, onlyFiles: true, dot: false })) {
    if (entry.split("/").some((p) => SKIP_DIRS.has(p))) continue;
    matches.push(entry);
  }
  return matches.sort();
}

function readSnippet(filePath: string, line?: number, radius = 2): string | undefined {
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    if (line !== undefined && line > 0) {
      const start = Math.max(0, line - 1 - radius);
      const end = Math.min(lines.length, line + radius);
      return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join("\n");
    }
    return lines.slice(0, Math.min(5, lines.length)).join("\n");
  } catch {
    return undefined;
  }
}

function resolveFileMention(target: string, cwd: string): ResolvedMention {
  const base: Omit<ResolvedMention, "status"> = {
    schema_version: MENTION_RESOLVER_SCHEMA,
    raw: `@file:${target}`,
    kind: "file",
    target,
  };

  const { path: rawPath, line } = parseFileTarget(target);
  const direct = resolve(cwd, rawPath);
  if (existsSync(direct) && statSync(direct).isFile()) {
    const rel = relative(cwd, direct);
    return {
      ...base,
      status: "resolved",
      link: `file://${direct}${line ? `#L${line}` : ""}`,
      snippet: readSnippet(direct, line),
      context: { path: rel, absolute_path: direct, line: line ?? null },
    };
  }

  const baseName = basename(rawPath);
  const candidates = findFilesByBasename(baseName, cwd);
  if (candidates.length === 0) {
    return { ...base, status: "missing" };
  }
  if (candidates.length > 1) {
    return {
      ...base,
      status: "ambiguous",
      candidates,
      context: { reason: "multiple files match basename", basename: baseName },
    };
  }

  const full = resolve(cwd, candidates[0]!);
  return {
    ...base,
    status: "resolved",
    link: `file://${full}${line ? `#L${line}` : ""}`,
    snippet: readSnippet(full, line),
    context: { path: candidates[0]!, absolute_path: full, line: line ?? null, matched_by: "basename" },
  };
}

function collectSourceFiles(cwd: string): string[] {
  const glob = new Bun.Glob("**/*");
  const files: string[] = [];
  for (const entry of glob.scanSync({ cwd, onlyFiles: true, dot: false })) {
    if (entry.split("/").some((p) => SKIP_DIRS.has(p))) continue;
    const dot = entry.lastIndexOf(".");
    if (dot === -1) continue;
    if (!CODE_EXTENSIONS.has(entry.slice(dot))) continue;
    files.push(entry);
  }
  return files;
}

function resolveSymbolMention(target: string, cwd: string): ResolvedMention {
  const base: Omit<ResolvedMention, "status"> = {
    schema_version: MENTION_RESOLVER_SCHEMA,
    raw: `@symbol:${target}`,
    kind: "symbol",
    target,
  };

  const [maybeFile, symbolName] = target.includes(":") && !target.startsWith("http")
    ? (() => {
        const idx = target.lastIndexOf(":");
        const filePart = target.slice(0, idx);
        const sym = target.slice(idx + 1);
        if (sym && !sym.includes("/")) return [filePart, sym] as const;
        return [undefined, target] as const;
      })()
    : [undefined, target];

  const files = maybeFile
    ? [maybeFile]
    : collectSourceFiles(cwd);

  const matches: Array<{ file: string; line: number; text: string }> = [];

  for (const file of files) {
    const full = resolve(cwd, file);
    if (!existsSync(full)) continue;
    let content: string;
    try {
      content = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const re of SYMBOL_DEF_RES) {
        re.lastIndex = 0;
        const m = re.exec(line);
        if (m?.[1] === symbolName) {
          matches.push({ file, line: i + 1, text: line.trim() });
        }
      }
    }
  }

  if (matches.length === 0) {
    return { ...base, status: "missing" };
  }
  if (matches.length > 1) {
    return {
      ...base,
      status: "ambiguous",
      candidates: matches.map((m) => `${m.file}:${m.line}`),
      context: { symbol: symbolName, matches },
    };
  }

  const hit = matches[0]!;
  const abs = resolve(cwd, hit.file);
  return {
    ...base,
    status: "resolved",
    link: `file://${abs}#L${hit.line}`,
    snippet: hit.text,
    context: { file: hit.file, line: hit.line, symbol: symbolName },
  };
}

function resolveTaskMention(target: string, db: Database): ResolvedMention {
  const base: Omit<ResolvedMention, "status"> = {
    schema_version: MENTION_RESOLVER_SCHEMA,
    raw: `@task:${target}`,
    kind: "task",
    target,
  };

  const resolvedId = resolvePartialId(db, "tasks", target);
  if (!resolvedId) {
    const rows = db.query("SELECT id FROM tasks WHERE short_id = ?").all(target) as { id: string }[];
    if (rows.length > 1) {
      return {
        ...base,
        status: "ambiguous",
        candidates: rows.map((r) => r.id),
      };
    }
    if (rows.length === 0) {
      return { ...base, status: "missing" };
    }
    const task = getTask(rows[0]!.id, db);
    if (!task) return { ...base, status: "missing" };
    return {
      ...base,
      status: "resolved",
      link: `todos://task/${task.id}`,
      snippet: task.title,
      context: {
        id: task.id,
        short_id: task.short_id,
        status: task.status,
        priority: task.priority,
      },
    };
  }

  const task = getTask(resolvedId, db);
  if (!task) return { ...base, status: "missing" };
  return {
    ...base,
    status: "resolved",
    link: `todos://task/${task.id}`,
    snippet: task.title,
    context: {
      id: task.id,
      short_id: task.short_id,
      status: task.status,
      priority: task.priority,
    },
  };
}

function resolvePlanMention(target: string, db: Database): ResolvedMention {
  const base: Omit<ResolvedMention, "status"> = {
    schema_version: MENTION_RESOLVER_SCHEMA,
    raw: `@plan:${target}`,
    kind: "plan",
    target,
  };

  const planId = resolvePlanRef(target, db);
  if (!planId) return { ...base, status: "missing" };

  const row = db.query("SELECT id, name, status FROM plans WHERE id = ?").get(planId) as
    | { id: string; name: string; status: string }
    | null;
  if (!row) return { ...base, status: "missing" };

  return {
    ...base,
    status: "resolved",
    link: `todos://plan/${row.id}`,
    snippet: row.name,
    context: { id: row.id, name: row.name, status: row.status },
  };
}

function resolveRunMention(target: string, db: Database): ResolvedMention {
  const base: Omit<ResolvedMention, "status"> = {
    schema_version: MENTION_RESOLVER_SCHEMA,
    raw: `@run:${target}`,
    kind: "run",
    target,
  };

  const runId = resolveRunId(target, db);
  if (!runId) {
    const rows = db.query("SELECT id FROM run_records WHERE id LIKE ?").all(`${target}%`) as { id: string }[];
    if (rows.length > 1) {
      return {
        ...base,
        status: "ambiguous",
        candidates: rows.map((r) => r.id),
      };
    }
    return { ...base, status: "missing" };
  }

  const record = getRunRecord(runId, db);
  if (!record) return { ...base, status: "missing" };

  return {
    ...base,
    status: "resolved",
    link: `todos://run/${record.id}`,
    snippet: record.objective ?? record.status,
    context: {
      id: record.id,
      status: record.status,
      agent_id: record.agent_id,
      started_at: record.started_at,
    },
  };
}

function resolveBranchMention(target: string, cwd: string): ResolvedMention {
  const base: Omit<ResolvedMention, "status"> = {
    schema_version: MENTION_RESOLVER_SCHEMA,
    raw: `@branch:${target}`,
    kind: "branch",
    target,
  };

  const root = resolveGitRoot(cwd);
  if (!root) return { ...base, status: "missing", context: { reason: "not a git repository" } };

  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--verify", target], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) {
      return { ...base, status: "missing" };
    }
    const sha = new TextDecoder().decode(result.stdout).trim();
    const current = getCurrentBranch(root);
    return {
      ...base,
      status: "resolved",
      link: `git://${root}#branch/${target}`,
      snippet: sha.slice(0, 12),
      context: { branch: target, sha, current_branch: current, repo_path: root },
    };
  } catch {
    return { ...base, status: "missing" };
  }
}

function resolveCommitMention(target: string, cwd: string): ResolvedMention {
  const base: Omit<ResolvedMention, "status"> = {
    schema_version: MENTION_RESOLVER_SCHEMA,
    raw: `@commit:${target}`,
    kind: "commit",
    target,
  };

  const info = inspectGitCommit(target, cwd);
  if (!info) return { ...base, status: "missing" };

  return {
    ...base,
    status: "resolved",
    link: `git://${info.repo_path ?? cwd}#commit/${info.sha}`,
    snippet: info.message.split("\n")[0],
    context: {
      sha: info.sha,
      author: info.author,
      committed_at: info.committed_at,
      files_changed: info.files_changed.slice(0, 10),
    },
  };
}

function resolvePrMention(target: string, cwd: string): ResolvedMention {
  const base: Omit<ResolvedMention, "status"> = {
    schema_version: MENTION_RESOLVER_SCHEMA,
    raw: target.startsWith("http") ? target : `@pr:${target}`,
    kind: "pr",
    target,
  };

  const prNumber = /^\d+$/.test(target)
    ? target
    : target.match(/\/pull\/(\d+)/)?.[1];

  if (!prNumber) return { ...base, status: "missing" };

  const root = resolveGitRoot(cwd) ?? cwd;
  try {
    const result = Bun.spawnSync(
      ["gh", "pr", "view", prNumber, "--json", "url,number,state,title"],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    if (result.exitCode === 0) {
      const parsed = JSON.parse(new TextDecoder().decode(result.stdout)) as {
        url: string;
        number: number;
        state: string;
        title: string;
      };
      return {
        ...base,
        status: "resolved",
        link: parsed.url,
        snippet: parsed.title,
        context: { number: parsed.number, state: parsed.state },
      };
    }
  } catch {
    // gh unavailable — fall through to local-only link
  }

  return {
    ...base,
    status: "resolved",
    link: target.startsWith("http") ? target : `local://pr/${prNumber}`,
    snippet: `PR #${prNumber}`,
    context: { number: parseInt(prNumber, 10), resolved_via: "local-only" },
  };
}

function resolveUrlMention(target: string): ResolvedMention {
  return {
    schema_version: MENTION_RESOLVER_SCHEMA,
    raw: target,
    kind: "url",
    target,
    status: "resolved",
    link: target,
    snippet: target.length > 80 ? `${target.slice(0, 77)}...` : target,
  };
}

function applyRedaction(mention: ResolvedMention, redact: boolean): ResolvedMention {
  if (!redact) return mention;
  const next = { ...mention, redacted: false };
  if (next.snippet) {
    const redacted = redactText(next.snippet);
    next.snippet = redacted;
    next.redacted = redacted !== mention.snippet;
  }
  if (next.context) {
    next.context = JSON.parse(redactText(JSON.stringify(next.context)));
  }
  return next;
}

export function resolveMention(
  kind: MentionKind,
  target: string,
  options: ResolveMentionOptions = {},
): ResolvedMention {
  const cwd = options.cwd ?? process.cwd();
  const db = options.db ?? getDatabase();
  const redact = options.redact !== false;

  let resolved: ResolvedMention;
  switch (kind) {
    case "file":
      resolved = resolveFileMention(target, cwd);
      break;
    case "symbol":
      resolved = resolveSymbolMention(target, cwd);
      break;
    case "task":
      resolved = resolveTaskMention(target, db);
      break;
    case "plan":
      resolved = resolvePlanMention(target, db);
      break;
    case "run":
      resolved = resolveRunMention(target, db);
      break;
    case "branch":
      resolved = resolveBranchMention(target, cwd);
      break;
    case "commit":
      resolved = resolveCommitMention(target, cwd);
      break;
    case "pr":
      resolved = resolvePrMention(target, cwd);
      break;
    case "url":
      resolved = resolveUrlMention(target);
      break;
    default:
      resolved = {
        schema_version: MENTION_RESOLVER_SCHEMA,
        raw: target,
        kind,
        target,
        status: "missing",
      };
  }

  return applyRedaction(resolved, redact);
}

export function resolveMentionsInText(
  text: string,
  options: ResolveMentionOptions = {},
): MentionResolutionResult {
  const parsed = parseMentions(text);
  const mentions = parsed.map((m) => resolveMention(m.kind, m.target, options));
  const redact = options.redact !== false;
  return {
    schema_version: MENTION_RESOLVER_SCHEMA,
    mentions,
    redacted_text: redact ? redactText(text) : undefined,
  };
}

export function formatResolvedMention(mention: ResolvedMention): string {
  const id = mention.context?.id ?? mention.context?.sha ?? mention.target;
  const parts = [
    `[${mention.kind}] ${mention.status}`,
    String(id),
  ];
  if (mention.link) parts.push(`→ ${mention.link}`);
  if (mention.snippet) parts.push(`"${mention.snippet}"`);
  if (mention.status === "ambiguous" && mention.candidates?.length) {
    parts.push(`candidates: ${mention.candidates.slice(0, 5).join(", ")}`);
  }
  return parts.join(" ");
}

export function formatMentionResolutionResult(result: MentionResolutionResult): string {
  if (result.mentions.length === 0) return "No mentions found.";
  return result.mentions.map(formatResolvedMention).join("\n");
}

export function getMentionResolverDocs(): string[] {
  return [
    "Mention syntax: @file:path[:line], @symbol:name, @task:id, @plan:name, @run:id, @branch:name, @commit:sha, @pr:number",
    "URLs and GitHub PR links are detected automatically.",
    "Snippets and context are redacted via secret-redaction boundaries.",
    "CLI: todos refs parse|resolve|scan|inspect",
    "MCP: parse_mentions, resolve_mention, resolve_mentions_in_text",
  ];
}
