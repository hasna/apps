import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getAgent, getAgentByName } from "../db/agents.js";
import { getDatabase, resolvePartialId } from "../db/database.js";
import { getPlan, listPlans } from "../db/plans.js";
import { getTaskRun, resolveTaskRunId } from "../db/task-runs.js";
import { getTask } from "../db/tasks.js";

export type MentionReferenceKind =
  | "file"
  | "symbol"
  | "commit"
  | "branch"
  | "pull_request"
  | "plan"
  | "run"
  | "agent"
  | "task"
  | "unknown";

export interface MentionResolverInput {
  mentions: string[];
  workspace?: string;
  include_symbol_context?: boolean;
  max_symbol_matches?: number;
  now?: string;
}

export interface MentionBacklink {
  kind: MentionReferenceKind;
  key: string;
  label: string;
  target: string;
}

export interface MentionResolution {
  input: string;
  kind: MentionReferenceKind;
  target: string;
  resolved: boolean;
  canonical: string | null;
  title: string | null;
  path: string | null;
  line: number | null;
  column: number | null;
  symbol: string | null;
  id: string | null;
  sha: string | null;
  backlinks: MentionBacklink[];
  warnings: string[];
}

export interface MentionResolutionReport {
  schema_version: 1;
  local_only: true;
  no_network: true;
  generated_at: string;
  workspace: string;
  references: MentionResolution[];
  backlinks: MentionBacklink[];
  warnings: string[];
}

interface ParsedMention {
  input: string;
  kind: MentionReferenceKind;
  target: string;
  explicit: boolean;
  line?: number;
}

const PREFIXES: Record<string, MentionReferenceKind> = {
  file: "file",
  path: "file",
  symbol: "symbol",
  commit: "commit",
  sha: "commit",
  branch: "branch",
  pr: "pull_request",
  pull: "pull_request",
  pull_request: "pull_request",
  plan: "plan",
  run: "run",
  agent: "agent",
  task: "task",
};

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".json",
  ".lua",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".tsx",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".todos",
  "coverage",
  "dist",
  "node_modules",
  "tmp",
  "vendor",
]);

function blankResolution(parsed: ParsedMention): MentionResolution {
  return {
    input: parsed.input,
    kind: parsed.kind,
    target: parsed.target,
    resolved: false,
    canonical: null,
    title: null,
    path: null,
    line: parsed.line ?? null,
    column: null,
    symbol: null,
    id: null,
    sha: null,
    backlinks: [],
    warnings: [],
  };
}

function backlink(kind: MentionReferenceKind, key: string, label: string, target = key): MentionBacklink {
  return { kind, key, label, target };
}

function normalizeWorkspace(workspace?: string): string {
  return resolve(workspace || process.cwd());
}

function isInside(root: string, absolutePath: string): boolean {
  const rel = relative(root, absolutePath);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`) && !isAbsolute(rel));
}

function normalizeRelativePath(value: string): string | null {
  const normalized = value.trim().replace(/^\.?\//, "").replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0")) return null;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.includes("..")) return null;
  return parts.join("/");
}

function parseLineAnchor(value: string): { path: string; line?: number } {
  const hashMatch = value.match(/^(.*?)(?:#L?|:)(\d+)$/);
  if (!hashMatch) return { path: value };
  return { path: hashMatch[1]!, line: Number.parseInt(hashMatch[2]!, 10) };
}

function looksLikeCommit(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value);
}

function looksLikeFile(value: string): boolean {
  return value.includes("/") || value.includes(".") || value.includes("#L") || /:\d+$/.test(value);
}

function parseMention(raw: string): ParsedMention {
  const input = raw.trim();
  const clean = input.startsWith("@") ? input.slice(1) : input;
  if (/^#\d+$/.test(clean)) {
    return { input, kind: "pull_request", target: clean.slice(1), explicit: true };
  }
  const prefixMatch = clean.match(/^([a-z_]+):(.*)$/i);
  if (prefixMatch && PREFIXES[prefixMatch[1]!.toLowerCase()]) {
    const kind = PREFIXES[prefixMatch[1]!.toLowerCase()]!;
    const target = prefixMatch[2]!.trim();
    if (kind === "file") {
      const parsed = parseLineAnchor(target);
      return { input, kind, target: parsed.path, line: parsed.line, explicit: true };
    }
    return { input, kind, target, explicit: true };
  }
  if (looksLikeCommit(clean)) return { input, kind: "commit", target: clean, explicit: false };
  if (looksLikeFile(clean)) {
    const parsed = parseLineAnchor(clean);
    return { input, kind: "file", target: parsed.path, line: parsed.line, explicit: false };
  }
  return { input, kind: "unknown", target: clean, explicit: false };
}

function runGit(root: string, args: string[]): string | null {
  try {
    const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) return null;
    return new TextDecoder().decode(result.stdout).trim();
  } catch {
    return null;
  }
}

function resolveFile(parsed: ParsedMention, workspace: string): MentionResolution {
  const resolution = blankResolution(parsed);
  const relPath = normalizeRelativePath(parsed.target);
  if (!relPath) {
    resolution.warnings.push("path is empty or escapes the workspace");
    return resolution;
  }
  const absolutePath = resolve(workspace, relPath);
  if (!isInside(workspace, absolutePath)) {
    resolution.path = relPath;
    resolution.warnings.push("path escapes the workspace");
    return resolution;
  }
  resolution.path = relPath;
  if (!existsSync(absolutePath)) {
    resolution.warnings.push("file does not exist in the local workspace");
    return resolution;
  }
  const stats = statSync(absolutePath);
  if (!stats.isFile()) {
    resolution.warnings.push("path exists but is not a file");
    return resolution;
  }
  if (parsed.line !== undefined) {
    const lineCount = readFileSync(absolutePath, "utf-8").split(/\r?\n/).length;
    if (parsed.line < 1 || parsed.line > lineCount) {
      resolution.warnings.push(`line ${parsed.line} is outside the file range 1-${lineCount}`);
      return resolution;
    }
  }
  resolution.resolved = true;
  resolution.canonical = parsed.line ? `file:${relPath}:${parsed.line}` : `file:${relPath}`;
  resolution.title = parsed.line ? `${relPath}:${parsed.line}` : relPath;
  resolution.backlinks.push(backlink("file", `file:${relPath}`, relPath));
  if (parsed.line) {
    resolution.backlinks.push(backlink("file", `file:${relPath}:${parsed.line}`, `${relPath}:${parsed.line}`, `file:${relPath}`));
  }
  return resolution;
}

function walkSourceFiles(root: string, current = root, files: string[] = []): string[] {
  if (files.length >= 5000) return files;
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && ![".github"].includes(entry.name)) {
      if (SKIP_DIRS.has(entry.name)) continue;
    }
    const absolutePath = join(current, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkSourceFiles(root, absolutePath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = `.${basename(entry.name).split(".").pop() || ""}`;
    if (SOURCE_EXTENSIONS.has(extension) && statSync(absolutePath).size <= 512 * 1024) {
      files.push(absolutePath);
    }
  }
  return files;
}

function symbolPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?(?:function|class|interface|type|const|let|var|enum)\\s+${escaped}\\b|\\b${escaped}\\s*[:=]\\s*(?:async\\s*)?(?:\\([^)]*\\)\\s*=>|function\\b)`);
}

function resolveSymbol(parsed: ParsedMention, workspace: string, maxMatches: number): MentionResolution {
  const resolution = blankResolution(parsed);
  const name = parsed.target.trim();
  resolution.symbol = name || null;
  if (!name) {
    resolution.warnings.push("symbol name is required");
    return resolution;
  }
  const pattern = symbolPattern(name);
  const matches: MentionBacklink[] = [];
  for (const file of walkSourceFiles(workspace)) {
    const lines = readFileSync(file, "utf-8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const found = pattern.exec(line);
      if (!found) continue;
      const relPath = relative(workspace, file).replace(/\\/g, "/");
      const lineNumber = index + 1;
      matches.push(backlink("symbol", `symbol:${name}@${relPath}:${lineNumber}`, `${name} in ${relPath}:${lineNumber}`, `file:${relPath}:${lineNumber}`));
      if (matches.length >= maxMatches) break;
    }
    if (matches.length >= maxMatches) break;
  }
  if (matches.length === 0) {
    resolution.warnings.push("symbol declaration not found in local source files");
    return resolution;
  }
  const first = matches[0]!;
  const target = first.target.replace(/^file:/, "");
  const parsedTarget = parseLineAnchor(target);
  resolution.resolved = true;
  resolution.canonical = first.key;
  resolution.title = first.label;
  resolution.path = parsedTarget.path;
  resolution.line = parsedTarget.line ?? null;
  resolution.backlinks.push(...matches);
  return resolution;
}

function resolveCommit(parsed: ParsedMention, workspace: string): MentionResolution {
  const resolution = blankResolution(parsed);
  const sha = runGit(workspace, ["rev-parse", "--verify", `${parsed.target}^{commit}`]);
  if (!sha) {
    resolution.warnings.push("commit was not found in the local git repository");
    return resolution;
  }
  resolution.resolved = true;
  resolution.sha = sha;
  resolution.canonical = `commit:${sha}`;
  resolution.title = sha.slice(0, 12);
  resolution.backlinks.push(backlink("commit", `commit:${sha}`, sha.slice(0, 12)));
  return resolution;
}

function resolveBranch(parsed: ParsedMention, workspace: string): MentionResolution {
  const resolution = blankResolution(parsed);
  const name = parsed.target.trim();
  const sha = runGit(workspace, ["rev-parse", "--verify", `refs/heads/${name}`])
    || runGit(workspace, ["rev-parse", "--verify", `refs/remotes/${name}`])
    || runGit(workspace, ["rev-parse", "--verify", name]);
  if (!sha) {
    resolution.warnings.push("branch was not found in local git refs");
    return resolution;
  }
  resolution.resolved = true;
  resolution.sha = sha;
  resolution.canonical = `branch:${name}`;
  resolution.title = name;
  resolution.backlinks.push(backlink("branch", `branch:${name}`, name, `commit:${sha}`));
  resolution.backlinks.push(backlink("commit", `commit:${sha}`, sha.slice(0, 12)));
  return resolution;
}

function resolvePullRequest(parsed: ParsedMention, workspace: string): MentionResolution {
  const resolution = blankResolution(parsed);
  const number = parsed.target.replace(/^#/, "").trim();
  if (!/^\d+$/.test(number)) {
    resolution.warnings.push("pull request reference must be a number");
    return resolution;
  }
  const sha = runGit(workspace, ["rev-parse", "--verify", `refs/pull/${number}/head`])
    || runGit(workspace, ["rev-parse", "--verify", `refs/remotes/pull/${number}/head`]);
  if (!sha) {
    resolution.warnings.push("pull request ref was not found in local git refs; hosted lookups are not used");
    return resolution;
  }
  resolution.resolved = true;
  resolution.sha = sha;
  resolution.canonical = `pr:${number}`;
  resolution.title = `#${number}`;
  resolution.backlinks.push(backlink("pull_request", `pr:${number}`, `#${number}`, `commit:${sha}`));
  resolution.backlinks.push(backlink("commit", `commit:${sha}`, sha.slice(0, 12)));
  return resolution;
}

function resolvePlan(parsed: ParsedMention, db: Database): MentionResolution {
  const resolution = blankResolution(parsed);
  let id = resolvePartialId(db, "plans", parsed.target);
  if (!id) {
    const plan = listPlans(undefined, db).find((item) => item.name.toLowerCase() === parsed.target.toLowerCase());
    id = plan?.id ?? null;
  }
  const plan = id ? getPlan(id, db) : null;
  if (!plan) {
    resolution.warnings.push("plan was not found in local state");
    return resolution;
  }
  resolution.resolved = true;
  resolution.id = plan.id;
  resolution.canonical = `plan:${plan.id}`;
  resolution.title = plan.name;
  resolution.backlinks.push(backlink("plan", `plan:${plan.id}`, plan.name));
  return resolution;
}

function resolveRun(parsed: ParsedMention, db: Database): MentionResolution {
  const resolution = blankResolution(parsed);
  try {
    const id = resolveTaskRunId(parsed.target, db);
    const run = getTaskRun(id, db);
    if (!run) throw new Error("missing run");
    resolution.resolved = true;
    resolution.id = run.id;
    resolution.canonical = `run:${run.id}`;
    resolution.title = run.title || run.id.slice(0, 8);
    resolution.backlinks.push(backlink("run", `run:${run.id}`, resolution.title));
    resolution.backlinks.push(backlink("task", `task:${run.task_id}`, "task", `run:${run.id}`));
  } catch {
    resolution.warnings.push("run was not found in local state");
  }
  return resolution;
}

function resolveAgent(parsed: ParsedMention, db: Database): MentionResolution {
  const resolution = blankResolution(parsed);
  const id = resolvePartialId(db, "agents", parsed.target);
  const agent = id ? getAgent(id, db) : getAgentByName(parsed.target, db);
  if (!agent) {
    resolution.warnings.push("agent was not found in local state");
    return resolution;
  }
  resolution.resolved = true;
  resolution.id = agent.id;
  resolution.canonical = `agent:${agent.id}`;
  resolution.title = agent.name;
  resolution.backlinks.push(backlink("agent", `agent:${agent.id}`, agent.name));
  return resolution;
}

function resolveTask(parsed: ParsedMention, db: Database): MentionResolution {
  const resolution = blankResolution(parsed);
  const id = resolvePartialId(db, "tasks", parsed.target);
  const task = id ? getTask(id, db) : null;
  if (!task) {
    resolution.warnings.push("task was not found in local state");
    return resolution;
  }
  resolution.resolved = true;
  resolution.id = task.id;
  resolution.canonical = `task:${task.id}`;
  resolution.title = task.title;
  resolution.backlinks.push(backlink("task", `task:${task.id}`, task.short_id || task.id.slice(0, 8)));
  if (task.plan_id) resolution.backlinks.push(backlink("plan", `plan:${task.plan_id}`, "plan", `task:${task.id}`));
  if (task.agent_id) resolution.backlinks.push(backlink("agent", `agent:${task.agent_id}`, "agent", `task:${task.id}`));
  return resolution;
}

function resolveUnknown(parsed: ParsedMention, workspace: string, db: Database, maxSymbolMatches: number): MentionResolution {
  const attempts = [
    () => resolveTask({ ...parsed, kind: "task" }, db),
    () => resolveAgent({ ...parsed, kind: "agent" }, db),
    () => resolvePlan({ ...parsed, kind: "plan" }, db),
    () => resolveSymbol({ ...parsed, kind: "symbol" }, workspace, maxSymbolMatches),
  ];
  for (const attempt of attempts) {
    const result = attempt();
    if (result.resolved) return { ...result, input: parsed.input };
  }
  const resolution = blankResolution(parsed);
  resolution.warnings.push("reference kind could not be inferred from local state");
  return resolution;
}

export function resolveMentions(input: MentionResolverInput, db?: Database): MentionResolutionReport {
  const workspace = normalizeWorkspace(input.workspace);
  const d = db || getDatabase();
  const maxSymbolMatches = Math.max(1, Math.min(input.max_symbol_matches ?? 20, 100));
  const references = input.mentions.map((mention) => {
    const parsed = parseMention(mention);
    switch (parsed.kind) {
      case "file": return resolveFile(parsed, workspace);
      case "symbol": return resolveSymbol(parsed, workspace, maxSymbolMatches);
      case "commit": return resolveCommit(parsed, workspace);
      case "branch": return resolveBranch(parsed, workspace);
      case "pull_request": return resolvePullRequest(parsed, workspace);
      case "plan": return resolvePlan(parsed, d);
      case "run": return resolveRun(parsed, d);
      case "agent": return resolveAgent(parsed, d);
      case "task": return resolveTask(parsed, d);
      default: return resolveUnknown(parsed, workspace, d, maxSymbolMatches);
    }
  });
  const backlinkMap = new Map<string, MentionBacklink>();
  for (const reference of references) {
    for (const item of reference.backlinks) backlinkMap.set(`${item.kind}:${item.key}:${item.target}`, item);
  }
  const warnings = references.flatMap((reference) => reference.warnings.map((warning) => `${reference.input}: ${warning}`));
  return {
    schema_version: 1,
    local_only: true,
    no_network: true,
    generated_at: input.now || new Date().toISOString(),
    workspace,
    references,
    backlinks: [...backlinkMap.values()],
    warnings,
  };
}
