import type { Loop, LoopRun, RunArtifactRef, RunReceipt, RunStatus, WorkflowSpec, WorkflowStep } from "../types.js";
import { conciseRunIssue, failureFamily, type ProjectLoopEntry } from "./project-discovery.js";
import { compactLoop, redact, scheduleSummary, targetSummary, truncateDisplay } from "./format.js";

export type AuditGroupBy = "status" | "loop" | "day" | "failure-family";
export type LintSeverity = "info" | "warn" | "error";

const DEFAULT_SUMMARY_OUTPUT_CHARS = 500;
const MAX_SUMMARY_OUTPUT_CHARS = 8_000;
const DEFAULT_DRILL_DOWN_LIMIT = 25;

export interface RunSummaryOptions {
  loop?: Loop;
  workflow?: WorkflowSpec;
  showOutput?: boolean;
  maxOutputChars?: number;
  includeTokens?: boolean;
}

export interface LoopLintIssue {
  code: "duplicate-name" | "wrapper-script" | "inline-base64" | "long-command" | "unbounded-output";
  severity: LintSeverity;
  message: string;
  loopId?: string;
  loopName?: string;
  loopIds?: string[];
  target?: string;
  targetPath?: string;
  hint: string;
}

export interface LintOptions {
  longCommandChars?: number;
}

interface OutputSummary {
  ref: string;
  chars: number;
  preview?: string;
  truncated?: boolean;
}

interface TokenUsage {
  total?: number;
  input?: number;
  output?: number;
  source: "stdout" | "stderr";
}

function boundedOutputChars(value: number | undefined): number {
  return Math.max(1, Math.min(value ?? DEFAULT_SUMMARY_OUTPUT_CHARS, MAX_SUMMARY_OUTPUT_CHARS));
}

function outputRef(run: LoopRun, stream: "stdout" | "stderr", chars: number): RunArtifactRef {
  return {
    kind: "output",
    stream,
    ref: `openloops://runs/${run.id}/${stream}`,
    chars,
  };
}

function summarizeOutput(run: LoopRun, stream: "stdout" | "stderr", showOutput: boolean, maxOutputChars: number): OutputSummary | undefined {
  const value = run[stream];
  if (!value) return undefined;
  const chars = value.length;
  const summary: OutputSummary = { ref: `openloops://runs/${run.id}/${stream}`, chars };
  if (!showOutput) return summary;
  summary.preview = value.length <= maxOutputChars ? value : value.slice(0, maxOutputChars);
  summary.truncated = value.length > maxOutputChars;
  return summary;
}

export function runArtifactRefs(run: LoopRun, extra: RunArtifactRef[] = []): RunArtifactRef[] {
  const refs: RunArtifactRef[] = [];
  if (run.stdout) refs.push(outputRef(run, "stdout", run.stdout.length));
  if (run.stderr) refs.push(outputRef(run, "stderr", run.stderr.length));
  return [...refs, ...extra];
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  if (value && typeof value === "object" && "total" in value) return numericValue((value as { total?: unknown }).total);
  return undefined;
}

function tokenUsageFromObject(value: unknown): Omit<TokenUsage, "source"> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  const usage = object.usage && typeof object.usage === "object" ? (object.usage as Record<string, unknown>) : object;
  const total =
    numericValue(usage.totalTokens) ??
    numericValue(usage.total_tokens) ??
    numericValue(usage.total) ??
    numericValue(usage.tokens);
  const input =
    numericValue(usage.inputTokens) ??
    numericValue(usage.input_tokens) ??
    numericValue(usage.promptTokens) ??
    numericValue(usage.prompt_tokens) ??
    numericValue(usage.input);
  const output =
    numericValue(usage.outputTokens) ??
    numericValue(usage.output_tokens) ??
    numericValue(usage.completionTokens) ??
    numericValue(usage.completion_tokens) ??
    numericValue(usage.output);
  if (total === undefined && input === undefined && output === undefined) return undefined;
  return { total, input, output };
}

function extractTokenUsageFromText(text: string | undefined, source: "stdout" | "stderr"): TokenUsage | undefined {
  if (!text) return undefined;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      const usage = tokenUsageFromObject(JSON.parse(trimmed));
      if (usage) return { ...usage, source };
    } catch {
      /* ignore non-JSON provider output */
    }
  }
  try {
    const usage = tokenUsageFromObject(JSON.parse(text));
    return usage ? { ...usage, source } : undefined;
  } catch {
    return undefined;
  }
}

export function extractRunTokenUsage(run: LoopRun): TokenUsage | undefined {
  return extractTokenUsageFromText(run.stdout, "stdout") ?? extractTokenUsageFromText(run.stderr, "stderr");
}

function countCommands(loop: Loop | undefined, workflow: WorkflowSpec | undefined): number | undefined {
  if (!loop) return undefined;
  if (loop.target.type === "command" || loop.target.type === "agent") return 1;
  if (!workflow) return undefined;
  return workflow.steps.length;
}

function agentTarget(loop: Loop | undefined, workflow: WorkflowSpec | undefined): Record<string, unknown> | undefined {
  const target = loop?.target.type === "agent" ? loop.target : undefined;
  if (target) {
    return {
      provider: target.provider,
      model: target.model,
      agent: target.agent,
      cwd: target.cwd,
      authProfile: target.authProfile,
      account: target.account?.profile,
      accountTool: target.account?.tool,
      sandbox: target.sandbox,
    };
  }
  const step = workflow?.steps.find((entry) => entry.target.type === "agent");
  if (!step || step.target.type !== "agent") return undefined;
  return {
    provider: step.target.provider,
    model: step.target.model,
    agent: step.target.agent,
    cwd: step.target.cwd,
    authProfile: step.target.authProfile,
    account: step.account?.profile ?? step.target.account?.profile,
    accountTool: step.account?.tool ?? step.target.account?.tool,
    sandbox: step.target.sandbox,
    workflowStepId: step.id,
  };
}

export function runSummary(run: LoopRun, opts: RunSummaryOptions = {}): Record<string, unknown> {
  const outputLimit = boundedOutputChars(opts.maxOutputChars);
  return {
    schema: "openloops.run_summary.v1",
    id: run.id,
    loopId: run.loopId,
    loopName: run.loopName,
    status: run.status,
    health: run.status === "succeeded" || run.status === "skipped" ? "ok" : run.status === "running" ? "running" : "needs_attention",
    attempt: run.attempt,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    issue: conciseRunIssue(run),
    failureFamily: failureFamily(run),
    target: opts.loop ? targetSummary(opts.loop.target) : undefined,
    agent: agentTarget(opts.loop, opts.workflow),
    counts: {
      commands: countCommands(opts.loop, opts.workflow),
      stdoutChars: run.stdout?.length ?? 0,
      stderrChars: run.stderr?.length ?? 0,
    },
    tokens: opts.includeTokens === false ? undefined : extractRunTokenUsage(run),
    output: {
      stdout: summarizeOutput(run, "stdout", Boolean(opts.showOutput), outputLimit),
      stderr: summarizeOutput(run, "stderr", Boolean(opts.showOutput), outputLimit),
      maxPreviewChars: opts.showOutput ? outputLimit : undefined,
    },
    artifacts: runArtifactRefs(run),
    updatedAt: run.updatedAt,
  };
}

export function runSummaryLine(summary: Record<string, unknown>): string {
  const counts = summary.counts as { stdoutChars?: number; stderrChars?: number; commands?: number } | undefined;
  const tokens = summary.tokens as { total?: number } | undefined;
  const issue = summary.issue ? ` issue=${summary.issue}` : "";
  const commandCount = counts?.commands === undefined ? "" : ` commands=${counts.commands}`;
  const tokenCount = tokens?.total === undefined ? "" : ` tokens=${tokens.total}`;
  return `${summary.id} ${summary.status} health=${summary.health} loop=${summary.loopName} stdout=${counts?.stdoutChars ?? 0} stderr=${counts?.stderrChars ?? 0}${commandCount}${tokenCount}${issue}`;
}

function redactReceiptValue(value: unknown, key?: string): unknown {
  if (key === "preview") {
    return typeof value === "string" ? `[redacted ${value.length} chars]` : "[redacted]";
  }
  if ((key === "target" || key === "issue" || key === "error") && typeof value === "string") return redact(value);
  if ((key === "stdout" || key === "stderr") && typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((entry) => redactReceiptValue(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactReceiptValue(entryValue, entryKey)]));
}

export function receiptSummary(receipt: RunReceipt): Record<string, unknown> {
  return {
    schema: "openloops.run_receipt.v1",
    id: receipt.id,
    loopId: receipt.loopId,
    runId: receipt.runId,
    taskId: receipt.taskId,
    conversationId: receipt.conversationId,
    knowledgeId: receipt.knowledgeId,
    artifacts: receipt.artifactRefs,
    summary: redactReceiptValue(receipt.summary),
    createdAt: receipt.createdAt,
  };
}

export function receiptLine(receipt: RunReceipt): string {
  const links = [
    receipt.taskId ? `task=${receipt.taskId}` : undefined,
    receipt.conversationId ? `conversation=${receipt.conversationId}` : undefined,
    receipt.knowledgeId ? `knowledge=${receipt.knowledgeId}` : undefined,
  ].filter(Boolean).join(" ");
  return `${receipt.id} run=${receipt.runId} loop=${receipt.loopId} artifacts=${receipt.artifactRefs.length}${links ? ` ${links}` : ""}`;
}

function dayKey(run: LoopRun): string {
  return (run.finishedAt ?? run.startedAt ?? run.createdAt).slice(0, 10);
}

function auditKey(run: LoopRun, groupBy: AuditGroupBy): string {
  if (groupBy === "status") return run.status;
  if (groupBy === "loop") return run.loopName;
  if (groupBy === "day") return dayKey(run);
  return failureFamily(run) ?? (run.status === "succeeded" ? "ok" : run.status);
}

export function auditRuns(
  runs: LoopRun[],
  opts: { since: string; groupBy: AuditGroupBy; status?: RunStatus; drillDownLimit?: number; scanLimit?: number; hasMore?: boolean },
): Record<string, unknown> {
  const groups = new Map<string, LoopRun[]>();
  for (const run of runs) {
    const key = auditKey(run, opts.groupBy);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const drillDownLimit = opts.drillDownLimit ?? DEFAULT_DRILL_DOWN_LIMIT;
  const grouped = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => ({
      key,
      count: values.length,
      runIds: values.slice(0, drillDownLimit).map((run) => run.id),
      truncated: values.length > drillDownLimit,
      statuses: countBy(values, (run) => run.status),
    }));
  return {
    schema: "openloops.audit.v1",
    since: opts.since,
    groupBy: opts.groupBy,
    status: opts.status,
    total: runs.length,
    scanned: runs.length,
    scanLimit: opts.scanLimit,
    hasMore: Boolean(opts.hasMore),
    truncatedByLimit: Boolean(opts.hasMore),
    statuses: countBy(runs, (run) => run.status),
    failureFamilies: countBy(runs, (run) => failureFamily(run) ?? (run.status === "succeeded" ? "ok" : run.status)),
    groups: grouped,
    runIds: runs.slice(0, drillDownLimit).map((run) => run.id),
    truncated: runs.length > drillDownLimit,
  };
}

export function auditLine(value: Record<string, unknown>): string {
  const statuses = value.statuses && typeof value.statuses === "object" ? formatCounts(value.statuses as Record<string, number>) : "";
  const failures = value.failureFamilies && typeof value.failureFamilies === "object" ? formatCounts(value.failureFamilies as Record<string, number>) : "";
  const more = value.hasMore ? " hasMore=yes" : "";
  return `audit since=${value.since} total=${value.total} groupBy=${value.groupBy}${statuses ? ` statuses=${statuses}` : ""}${failures ? ` failures=${failures}` : ""}${more}`;
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const entry = key(value);
    counts[entry] = (counts[entry] ?? 0) + 1;
  }
  return counts;
}

function countDefinedBy<T>(values: T[], key: (value: T) => string | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const entry = key(value);
    if (!entry) continue;
    counts[entry] = (counts[entry] ?? 0) + 1;
  }
  return counts;
}

function commandText(target: Loop["target"] | WorkflowStep["target"]): string | undefined {
  if (target.type !== "command") return undefined;
  return [target.command, ...(target.args ?? [])].join(" ");
}

function hasOutputCap(command: string): boolean {
  return /\b(head|tail)\b|\bsed\s+-n\b|--max-count\b|\s-m\s+\d+\b|--limit\b|--max-output|--max-old-space-size|\btimeout\s+\d+/i.test(command);
}

function looksHighOutput(command: string): boolean {
  return /\b(cat|find|rg|grep|git\s+(diff|log|show)|ls\s+-R|du\s+-a|tree)\b/i.test(command);
}

function commandIssues(loop: Loop, target: Loop["target"] | WorkflowStep["target"], targetPath: string, opts: Required<LintOptions>): LoopLintIssue[] {
  const command = commandText(target);
  if (!command) return [];
  const issues: LoopLintIssue[] = [];
  const base = {
    loopId: loop.id,
    loopName: loop.name,
    target: truncateDisplay(command, 160),
    targetPath,
  };
  if (command.length > opts.longCommandChars) {
    issues.push({
      ...base,
      code: "long-command",
      severity: "warn",
      message: `command is ${command.length} chars`,
      hint: "Move complex behavior into a script or native agent/workflow target with bounded inputs.",
    });
  }
  if (/\b(base64\s+(-d|--decode)|openssl\s+base64)\b|[A-Za-z0-9+/]{120,}={0,2}/.test(command)) {
    issues.push({
      ...base,
      code: "inline-base64",
      severity: "error",
      message: "command appears to embed or decode inline base64",
      hint: "Store artifacts as files or structured inputs and reference them by path instead of embedding payloads.",
    });
  }
  if (/\b(bash|sh|zsh)\s+-c\b|\bmktemp\b|cat\s+>|\beval\b|chmod\s+\+x|printf\s+.+\|\s*(codewith|claude|codex|cursor-agent|aicopilot|opencode)/is.test(command)) {
    issues.push({
      ...base,
      code: "wrapper-script",
      severity: "warn",
      message: "command looks like a wrapper around generated shell or an agent CLI",
      hint: "Use `loops create agent` or a workflow step so OpenLoops owns prompt delivery, timeout, and output bounds.",
    });
  }
  if (looksHighOutput(command) && !hasOutputCap(command)) {
    issues.push({
      ...base,
      code: "unbounded-output",
      severity: "warn",
      message: "command may emit unbounded output",
      hint: "Add an output limiter such as head, sed -n, --max-count, --limit, or prefer a compact native summary command.",
    });
  }
  return issues;
}

export function lintLoops(loops: Loop[], workflows: Map<string, WorkflowSpec> = new Map(), opts: LintOptions = {}): Record<string, unknown> {
  const resolvedOpts: Required<LintOptions> = { longCommandChars: opts.longCommandChars ?? 500 };
  const issues: LoopLintIssue[] = [];
  const names = new Map<string, Loop[]>();
  for (const loop of loops) names.set(loop.name, [...(names.get(loop.name) ?? []), loop]);
  for (const [name, entries] of names.entries()) {
    if (entries.length < 2) continue;
    issues.push({
      code: "duplicate-name",
      severity: "error",
      message: `duplicate loop name: ${name}`,
      loopName: name,
      loopIds: entries.map((entry) => entry.id),
      hint: "Rename or remove duplicates so agents can resolve id-or-name operations deterministically.",
    });
  }
  for (const loop of loops) {
    issues.push(...commandIssues(loop, loop.target, "loop.target", resolvedOpts));
    if (loop.target.type !== "workflow") continue;
    const workflow = workflows.get(loop.target.workflowId);
    for (const step of workflow?.steps ?? []) {
      issues.push(...commandIssues(loop, step.target, `workflow:${workflow?.id}:step:${step.id}`, resolvedOpts));
    }
  }
  const sorted = issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.code.localeCompare(b.code) || (a.loopName ?? "").localeCompare(b.loopName ?? ""));
  return {
    schema: "openloops.lint.v1",
    ok: sorted.length === 0,
    summary: {
      loops: loops.length,
      issues: sorted.length,
      bySeverity: countBy(sorted, (issue) => issue.severity),
      byCode: countBy(sorted, (issue) => issue.code),
    },
    issues: sorted,
  };
}

export function lintIssueLine(issue: LoopLintIssue): string {
  const ids = issue.loopIds?.length ? ` loopIds=${issue.loopIds.join(",")}` : issue.loopId ? ` loop=${issue.loopId}` : "";
  const target = issue.targetPath ? ` target=${issue.targetPath}` : "";
  return `${issue.severity} ${issue.code}${ids}${target} ${issue.message}. ${issue.hint}`;
}

export function healthReport(entries: ProjectLoopEntry[], opts: { showOutput?: boolean; maxOutputChars?: number; includeLoops?: boolean } = {}): Record<string, unknown> {
  const loops = opts.includeLoops === false ? undefined : entries.map((entry) => ({
    loop: compactLoop(entry.loop),
    latestRun: entry.latestRun
      ? runSummary(entry.latestRun, { loop: entry.loop, showOutput: opts.showOutput, maxOutputChars: opts.maxOutputChars, includeTokens: false })
      : undefined,
    latestRunIssue: conciseRunIssue(entry.latestRun),
    match: entry.match,
  }));
  return {
    schema: "openloops.health.v1",
    total: entries.length,
    statuses: countBy(entries, (entry) => entry.loop.status),
    latestRunStatuses: countBy(entries, (entry) => entry.latestRun?.status ?? "none"),
    failureFamilies: countDefinedBy(entries, (entry) => failureFamily(entry.latestRun)),
    loops,
  };
}

export function healthLine(value: Record<string, unknown>): string {
  const latest = value.latestRunStatuses && typeof value.latestRunStatuses === "object" ? formatCounts(value.latestRunStatuses as Record<string, number>) : "";
  const failures = value.failureFamilies && typeof value.failureFamilies === "object" ? formatCounts(value.failureFamilies as Record<string, number>) : "";
  return `health loops=${value.total} latest=${latest || "none"} failures=${failures || "none"}`;
}

export function externalArtifact(ref: string): RunArtifactRef {
  return { kind: "external", ref };
}

function severityRank(severity: LintSeverity): number {
  if (severity === "error") return 3;
  if (severity === "warn") return 2;
  return 1;
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, value]) => value > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}
