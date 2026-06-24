import { existsSync, realpathSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import type { AccountRef, Loop, LoopRun, LoopTarget, WorkflowSpec } from "../types.js";
import { scheduleSummary, targetSummary, truncateDisplay } from "./format.js";

export interface ProjectFilter {
  repo?: string;
  cwd?: string;
  name?: string;
  text?: string;
}

export interface ProjectMatchReason {
  field: string;
  kind: "path" | "text" | "metadata";
}

export interface ProjectLoopMatch {
  matched: boolean;
  reasons: ProjectMatchReason[];
  cwd?: string;
  provider?: string;
  account?: string;
}

export interface ProjectLoopEntry {
  loop: Loop;
  match: ProjectLoopMatch;
  latestRun?: LoopRun;
}

export interface ProjectHealthSummary {
  total: number;
  loopStatuses: Record<string, number>;
  latestRunStatuses: Record<string, number>;
  failureFamilies: Record<string, number>;
}

interface SearchField {
  field: string;
  value: string;
  path?: boolean;
  metadata?: boolean;
}

interface QueryInfo {
  raw: string;
  lower: string;
  basename: string;
  path?: string;
  pathLike: boolean;
}

type LoopWithMetadata = Loop & { metadata?: Record<string, unknown> };

function addField(fields: SearchField[], field: string, value: unknown, opts: { path?: boolean; metadata?: boolean } = {}): void {
  if (typeof value === "string" && value.trim()) fields.push({ field, value, ...opts });
}

function addObjectFields(fields: SearchField[], prefix: string, value: unknown, opts: { metadata?: boolean } = {}): void {
  if (!value || typeof value !== "object") return;
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue === "string" || typeof entryValue === "number" || typeof entryValue === "boolean") {
      const stringValue = String(entryValue);
      fields.push({
        field: `${prefix}.${key}`,
        value: stringValue,
        path: key.toLowerCase().includes("path") || key.toLowerCase() === "cwd",
        metadata: opts.metadata,
      });
    }
  }
}

function addTargetFields(fields: SearchField[], prefix: string, target: LoopTarget): void {
  addField(fields, `${prefix}.type`, target.type);
  if (target.type === "command") {
    addField(fields, `${prefix}.command`, target.command);
    addField(fields, `${prefix}.args`, target.args?.join(" "));
    addField(fields, `${prefix}.cwd`, target.cwd, { path: true });
    addObjectFields(fields, `${prefix}.env`, target.env);
    addAccountFields(fields, `${prefix}.account`, target.account);
    return;
  }
  if (target.type === "agent") {
    addField(fields, `${prefix}.provider`, target.provider);
    addField(fields, `${prefix}.prompt`, target.prompt);
    addField(fields, `${prefix}.cwd`, target.cwd, { path: true });
    addField(fields, `${prefix}.model`, target.model);
    addField(fields, `${prefix}.agent`, target.agent);
    addField(fields, `${prefix}.authProfile`, target.authProfile);
    addField(fields, `${prefix}.extraArgs`, target.extraArgs?.join(" "));
    addAccountFields(fields, `${prefix}.account`, target.account);
    return;
  }
  addField(fields, `${prefix}.workflowId`, target.workflowId);
  addObjectFields(fields, `${prefix}.input`, target.input);
}

function addAccountFields(fields: SearchField[], prefix: string, account: AccountRef | undefined): void {
  if (!account) return;
  addField(fields, `${prefix}.profile`, account.profile);
  addField(fields, `${prefix}.tool`, account.tool);
}

function pathLike(value: string): boolean {
  return value.includes("/") || value.includes("\\") || value.startsWith(".") || value.startsWith("~") || existsSync(value);
}

function normalizePath(value: string): string {
  const expanded = value.startsWith("~/") ? `${process.env.HOME ?? ""}${value.slice(1)}` : value;
  const absolute = resolve(expanded);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function queryInfo(raw: string): QueryInfo {
  const trimmed = raw.trim();
  const isPathLike = pathLike(trimmed);
  const normalizedPath = isPathLike ? normalizePath(trimmed) : undefined;
  const base = basename(normalizedPath ?? trimmed);
  return {
    raw: trimmed,
    lower: trimmed.toLowerCase(),
    basename: base.toLowerCase(),
    path: normalizedPath,
    pathLike: isPathLike,
  };
}

function normalizeCandidatePath(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!pathLike(trimmed)) return undefined;
  return normalizePath(trimmed);
}

function pathMatches(candidate: string, query: QueryInfo): boolean {
  const candidatePath = normalizeCandidatePath(candidate);
  if (!candidatePath) return false;
  const candidateLower = candidatePath.toLowerCase();
  const candidateBase = basename(candidatePath).toLowerCase();
  if (query.path) {
    const queryLower = query.path.toLowerCase();
    return candidateLower === queryLower || candidateLower.startsWith(`${queryLower}${sep}`);
  }
  return candidateBase === query.basename;
}

function textMatches(candidate: string, query: QueryInfo): boolean {
  const value = candidate.toLowerCase();
  if (value.includes(query.lower)) return true;
  if (query.basename && value.includes(query.basename)) return true;
  if (query.path && value.includes(query.path.toLowerCase())) return true;
  return false;
}

function addReason(reasons: ProjectMatchReason[], seen: Set<string>, reason: ProjectMatchReason): void {
  const key = `${reason.field}:${reason.kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  reasons.push(reason);
}

function searchFields(loop: Loop, workflow?: WorkflowSpec): SearchField[] {
  const fields: SearchField[] = [];
  addField(fields, "loop.id", loop.id);
  addField(fields, "loop.name", loop.name);
  addField(fields, "loop.description", loop.description);
  addField(fields, "loop.labels", loop.labels?.join(" "));
  addField(fields, "loop.goal.objective", loop.goal?.objective);
  addTargetFields(fields, "loop.target", loop.target);
  addObjectFields(fields, "loop.metadata", (loop as LoopWithMetadata).metadata, { metadata: true });

  if (workflow) {
    addField(fields, "workflow.id", workflow.id);
    addField(fields, "workflow.name", workflow.name);
    addField(fields, "workflow.description", workflow.description);
    addField(fields, "workflow.goal.objective", workflow.goal?.objective);
    workflow.steps.forEach((step, index) => {
      const prefix = `workflow.steps.${index}`;
      addField(fields, `${prefix}.id`, step.id);
      addField(fields, `${prefix}.name`, step.name);
      addField(fields, `${prefix}.description`, step.description);
      addField(fields, `${prefix}.goal.objective`, step.goal?.objective);
      addTargetFields(fields, `${prefix}.target`, step.target);
      addAccountFields(fields, `${prefix}.account`, step.account);
    });
  }

  return fields;
}

export function hasProjectFilters(filter: ProjectFilter): boolean {
  return Boolean(filter.repo || filter.cwd || filter.name || filter.text);
}

export function loopTargetCwd(loop: Loop, workflow?: WorkflowSpec): string | undefined {
  if (loop.target.type !== "workflow") return loop.target.cwd;
  const inputPath = loop.target.input?.OPENLOOPS_REPO_PATH ?? loop.target.input?.repoPath ?? loop.target.input?.repo_path;
  if (inputPath) return inputPath;
  return workflow?.steps.find((step) => step.target.cwd)?.target.cwd;
}

export function loopProvider(loop: Loop, workflow?: WorkflowSpec): string | undefined {
  if (loop.target.type === "agent") return loop.target.provider;
  if (loop.target.type === "command") return "command";
  const agentStep = workflow?.steps.find((step) => step.target.type === "agent");
  if (agentStep?.target.type === "agent") return `workflow/${agentStep.target.provider}`;
  return "workflow";
}

export function loopAccount(loop: Loop, workflow?: WorkflowSpec): string | undefined {
  if (loop.target.type === "command") return formatAccount(loop.target.account);
  if (loop.target.type === "agent") return loop.target.authProfile ?? formatAccount(loop.target.account);
  if (!workflow) return undefined;
  for (const step of workflow.steps) {
    const direct = formatAccount(step.account);
    if (direct) return direct;
    if (step.target.type === "command") {
      const account = formatAccount(step.target.account);
      if (account) return account;
    }
    if (step.target.type === "agent") {
      const account = step.target.authProfile ?? formatAccount(step.target.account);
      if (account) return account;
    }
  }
  return undefined;
}

function formatAccount(account: AccountRef | undefined): string | undefined {
  if (!account) return undefined;
  return account.tool ? `${account.profile}/${account.tool}` : account.profile;
}

export function matchLoopToProject(loop: Loop, filter: ProjectFilter, workflow?: WorkflowSpec): ProjectLoopMatch | undefined {
  const reasons: ProjectMatchReason[] = [];
  const seen = new Set<string>();
  const fields = searchFields(loop, workflow);

  if (filter.repo) {
    const repo = queryInfo(filter.repo);
    let matched = false;
    for (const field of fields) {
      const didMatch = field.path ? pathMatches(field.value, repo) : textMatches(field.value, repo);
      if (didMatch) addReason(reasons, seen, { field: field.field, kind: field.metadata ? "metadata" : field.path ? "path" : "text" });
      matched = matched || didMatch;
    }
    if (!matched) return undefined;
  }

  if (filter.cwd) {
    const cwd = queryInfo(filter.cwd);
    let matched = false;
    for (const field of fields) {
      if (!field.path || !pathMatches(field.value, cwd)) continue;
      addReason(reasons, seen, { field: field.field, kind: "path" });
      matched = true;
    }
    if (!matched) return undefined;
  }

  if (filter.name) {
    const nameNeedle = filter.name.toLowerCase();
    if (!loop.name.toLowerCase().includes(nameNeedle)) return undefined;
    addReason(reasons, seen, { field: "loop.name", kind: "text" });
  }

  if (filter.text) {
    const text = queryInfo(filter.text);
    let matched = false;
    for (const field of fields) {
      if (!textMatches(field.value, text)) continue;
      addReason(reasons, seen, { field: field.field, kind: field.metadata ? "metadata" : "text" });
      matched = true;
    }
    if (!matched) return undefined;
  }

  return {
    matched: true,
    reasons,
    cwd: loopTargetCwd(loop, workflow),
    provider: loopProvider(loop, workflow),
    account: loopAccount(loop, workflow),
  };
}

export function failureFamily(run: LoopRun | undefined): string | undefined {
  if (!run || !["failed", "timed_out", "abandoned"].includes(run.status)) return undefined;
  const detail = `${run.status} ${run.error ?? ""} ${run.stderr ?? ""}`.toLowerCase();
  if (run.status === "timed_out" || detail.includes("timeout") || detail.includes("timed out")) return "timeout";
  if (detail.includes("context length") || detail.includes("maximum context") || detail.includes("token limit")) return "context_length";
  if (detail.includes("schema") || detail.includes("zod") || detail.includes("invalid json") || detail.includes("json schema")) return "schema_error";
  if (detail.includes("profile") || detail.includes("auth") || detail.includes("credential") || detail.includes("login")) return "auth_profile";
  if (detail.includes("npm") || detail.includes("bun install") || detail.includes("node_modules") || detail.includes("module not found")) return "node_init";
  if (run.exitCode !== undefined) return `exit_${run.exitCode}`;
  return "other";
}

export function conciseRunIssue(run: LoopRun | undefined): string | undefined {
  if (!run || !["failed", "timed_out", "abandoned"].includes(run.status)) return undefined;
  if (run.error) return truncateDisplay(run.error, 120);
  if (run.exitCode !== undefined) return `exit=${run.exitCode}${run.stderr ? " stderr=yes" : ""}`;
  if (run.stderr) return "stderr=yes";
  return run.status;
}

export function summarizeProjectHealth(entries: ProjectLoopEntry[]): ProjectHealthSummary {
  const summary: ProjectHealthSummary = {
    total: entries.length,
    loopStatuses: {},
    latestRunStatuses: {},
    failureFamilies: {},
  };
  for (const entry of entries) {
    summary.loopStatuses[entry.loop.status] = (summary.loopStatuses[entry.loop.status] ?? 0) + 1;
    const runStatus = entry.latestRun?.status ?? "none";
    summary.latestRunStatuses[runStatus] = (summary.latestRunStatuses[runStatus] ?? 0) + 1;
    const family = failureFamily(entry.latestRun);
    if (family) summary.failureFamilies[family] = (summary.failureFamilies[family] ?? 0) + 1;
  }
  return summary;
}

export function discoveryLoopLine(entry: ProjectLoopEntry): string {
  const loop = entry.loop;
  const run = entry.latestRun;
  const latestAt = run?.finishedAt ?? run?.startedAt ?? run?.createdAt ?? "-";
  const latest = run ? `${run.status} run=${run.id} at=${latestAt}` : "none";
  const cwd = entry.match.cwd ? ` cwd=${truncateDisplay(entry.match.cwd, 72)}` : "";
  const provider = entry.match.provider ? ` provider=${entry.match.provider}` : "";
  const account = entry.match.account ? ` account=${entry.match.account}` : "";
  const issue = conciseRunIssue(run);
  const error = issue ? ` error=${issue}` : "";
  return [
    `${loop.id}  ${loop.status.padEnd(7)}  next=${loop.nextRunAt ?? "-"}  latest=${latest}`,
    `${truncateDisplay(loop.name, 80)}  schedule=${scheduleSummary(loop.schedule)}  target=${targetSummary(loop.target)}${cwd}${provider}${account}${error}`,
  ].join("  ");
}

export function summaryLine(summary: ProjectHealthSummary): string {
  const loopStatuses = formatCounts(summary.loopStatuses);
  const runStatuses = formatCounts(summary.latestRunStatuses);
  const families = formatCounts(summary.failureFamilies) || "none";
  return `loops=${summary.total}${loopStatuses ? ` ${loopStatuses}` : ""}; latest=${runStatuses || "none"}; failures=${families}`;
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}
