import { basename } from "node:path";
import type { Loop, LoopRun, RunStatus, WorkflowSpec, WorkflowStep } from "../types.js";
import { redact } from "./format.js";
import { classifyRunFailure } from "./health.js";
import { scrubSecrets } from "./redact.js";

export type AuditGroupBy = "status" | "loop" | "day" | "failure-family";
export type LintSeverity = "warn" | "error";

export interface RunSummaryOptions {
  loop?: Loop;
  workflow?: WorkflowSpec;
  showOutput?: boolean;
  maxOutputChars?: number;
  includeTokens?: boolean;
}

export interface RunArtifactRef {
  kind: "output";
  stream: "stdout" | "stderr";
  ref: string;
  chars: number;
}

export interface LoopLintIssue {
  code: "wrapper-script" | "inline-base64" | "long-command" | "unbounded-output";
  severity: LintSeverity;
  message: string;
  loopId: string;
  loopName: string;
  targetPath: string;
  target: string;
  hint: string;
}

export interface LintOptions {
  longCommandChars?: number;
}

const DEFAULT_SUMMARY_OUTPUT_CHARS = 500;
const MAX_SUMMARY_OUTPUT_CHARS = 8_000;
const DEFAULT_DRILL_DOWN_LIMIT = 25;
const TOKEN_SCAN_CHARS = 64 * 1024;

function boundedOutputChars(value: number | undefined): number {
  return Math.max(1, Math.min(value ?? DEFAULT_SUMMARY_OUTPUT_CHARS, MAX_SUMMARY_OUTPUT_CHARS));
}

function compactIssue(run: LoopRun): string | undefined {
  const failure = classifyRunFailure(run);
  const value = failure?.evidence.summary ?? run.error ?? failure?.evidence.stderr ?? failure?.evidence.stdout;
  if (!value) return undefined;
  return redact(scrubSecrets(value).replace(/\s+/g, " ").trim(), 240);
}

function artifactRef(run: LoopRun, stream: "stdout" | "stderr", chars: number): RunArtifactRef {
  return {
    kind: "output",
    stream,
    ref: `openloops://runs/${run.id}/${stream}`,
    chars,
  };
}

export function runArtifactRefs(run: LoopRun): RunArtifactRef[] {
  const refs: RunArtifactRef[] = [];
  if (run.stdout) refs.push(artifactRef(run, "stdout", run.stdout.length));
  if (run.stderr) refs.push(artifactRef(run, "stderr", run.stderr.length));
  return refs;
}

function summarizeOutput(
  run: LoopRun,
  stream: "stdout" | "stderr",
  showOutput: boolean,
  maxOutputChars: number,
): { ref: string; chars: number; preview?: string; truncated?: boolean } | undefined {
  const value = run[stream];
  if (!value) return undefined;
  const summary: { ref: string; chars: number; preview?: string; truncated?: boolean } = {
    ref: `openloops://runs/${run.id}/${stream}`,
    chars: value.length,
  };
  if (!showOutput) return summary;
  const scrubbed = scrubSecrets(value);
  summary.preview = scrubbed.slice(0, maxOutputChars);
  summary.truncated = value.length > maxOutputChars;
  return summary;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function tokenUsageFromObject(value: unknown): { total?: number; input?: number; output?: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  const usage = object.usage && typeof object.usage === "object" && !Array.isArray(object.usage)
    ? object.usage as Record<string, unknown>
    : object;
  const total = numericValue(usage.totalTokens) ?? numericValue(usage.total_tokens) ?? numericValue(usage.total);
  const input = numericValue(usage.inputTokens) ?? numericValue(usage.input_tokens) ?? numericValue(usage.promptTokens)
    ?? numericValue(usage.prompt_tokens) ?? numericValue(usage.input);
  const output = numericValue(usage.outputTokens) ?? numericValue(usage.output_tokens) ?? numericValue(usage.completionTokens)
    ?? numericValue(usage.completion_tokens) ?? numericValue(usage.output);
  if (total === undefined && input === undefined && output === undefined) return undefined;
  return { total, input, output };
}

function extractTokenUsageFromText(
  text: string | undefined,
  source: "stdout" | "stderr",
): { total?: number; input?: number; output?: number; source: "stdout" | "stderr" } | undefined {
  if (!text) return undefined;
  const bounded = text.length <= TOKEN_SCAN_CHARS * 2
    ? text
    : `${text.slice(0, TOKEN_SCAN_CHARS)}\n${text.slice(-TOKEN_SCAN_CHARS)}`;
  for (const line of bounded.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      const usage = tokenUsageFromObject(JSON.parse(trimmed));
      if (usage) return { ...usage, source };
    } catch {
      // Provider output is commonly mixed text; ignore non-JSON lines.
    }
  }
  return undefined;
}

export function extractRunTokenUsage(run: LoopRun) {
  return extractTokenUsageFromText(run.stdout, "stdout") ?? extractTokenUsageFromText(run.stderr, "stderr");
}

function commandCount(loop: Loop | undefined, workflow: WorkflowSpec | undefined): number | undefined {
  if (!loop) return undefined;
  if (loop.target.type === "workflow") return workflow?.steps.length;
  return 1;
}

function targetSummary(loop: Loop | undefined): Record<string, unknown> | undefined {
  if (!loop) return undefined;
  if (loop.target.type === "command") {
    const executable = loop.target.shell || /\s/.test(loop.target.command)
      ? redact(scrubSecrets(loop.target.command))
      : basename(loop.target.command);
    return {
      type: "command",
      executable,
      args: loop.target.args?.length ?? 0,
      cwd: loop.target.cwd,
      shell: Boolean(loop.target.shell),
    };
  }
  if (loop.target.type === "agent") {
    return {
      type: "agent",
      provider: loop.target.provider,
      model: loop.target.model,
      agent: loop.target.agent,
      cwd: loop.target.cwd,
      sandbox: loop.target.sandbox,
    };
  }
  return { type: "workflow", workflowId: loop.target.workflowId };
}

export function runSummary(run: LoopRun, opts: RunSummaryOptions = {}): Record<string, unknown> {
  const outputLimit = boundedOutputChars(opts.maxOutputChars);
  const failure = classifyRunFailure(run);
  return {
    schema: "openloops.run_summary.v1",
    id: run.id,
    loopId: run.loopId,
    loopName: run.loopName,
    status: run.status,
    health: run.status === "succeeded" || run.status === "skipped"
      ? "ok"
      : run.status === "running"
        ? "running"
        : "needs_attention",
    attempt: run.attempt,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    issue: compactIssue(run),
    failureFamily: failure?.classification,
    target: targetSummary(opts.loop),
    counts: {
      commands: commandCount(opts.loop, opts.workflow),
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
  const commands = counts?.commands === undefined ? "" : ` commands=${counts.commands}`;
  const tokenCount = tokens?.total === undefined ? "" : ` tokens=${tokens.total}`;
  return `${summary.id} ${summary.status} health=${summary.health} loop=${summary.loopName} stdout=${counts?.stdoutChars ?? 0} stderr=${counts?.stderrChars ?? 0}${commands}${tokenCount}${issue}`;
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const entry = key(value);
    counts[entry] = (counts[entry] ?? 0) + 1;
  }
  return counts;
}

function runDay(run: LoopRun): string {
  return (run.finishedAt ?? run.startedAt ?? run.createdAt).slice(0, 10);
}

function failureFamily(run: LoopRun): string {
  return classifyRunFailure(run)?.classification ?? (run.status === "succeeded" ? "ok" : run.status);
}

function auditKey(run: LoopRun, groupBy: AuditGroupBy): string {
  if (groupBy === "status") return run.status;
  if (groupBy === "loop") return run.loopName;
  if (groupBy === "day") return runDay(run);
  return failureFamily(run);
}

export function auditRuns(
  runs: LoopRun[],
  opts: {
    since: string;
    groupBy: AuditGroupBy;
    status?: RunStatus;
    drillDownLimit?: number;
    scanLimit?: number;
    hasMore?: boolean;
  },
): Record<string, unknown> {
  const groups = new Map<string, LoopRun[]>();
  for (const run of runs) {
    const key = auditKey(run, opts.groupBy);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const drillDownLimit = Math.max(1, opts.drillDownLimit ?? DEFAULT_DRILL_DOWN_LIMIT);
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
    failureFamilies: countBy(runs, failureFamily),
    groups: grouped,
    runIds: runs.slice(0, drillDownLimit).map((run) => run.id),
    truncated: runs.length > drillDownLimit,
  };
}

export function auditLine(value: Record<string, unknown>): string {
  return `audit since=${value.since} total=${value.total} groupBy=${value.groupBy}${value.hasMore ? " hasMore=yes" : ""}`;
}

function commandText(target: Loop["target"] | WorkflowStep["target"]): string | undefined {
  if (target.type !== "command") return undefined;
  return [target.command, ...(target.args ?? [])].join(" ").trim();
}

function isWrapperShell(target: Loop["target"] | WorkflowStep["target"], command: string): boolean {
  if (target.type !== "command") return false;
  const executable = basename(target.command).toLowerCase();
  const shellExecutable = /^(?:ba|z|da|k|fi)?sh$/.test(executable);
  const hasCommandStringFlag = (target.args ?? []).some((arg) => arg === "-c" || arg === "-lc");
  return Boolean(target.shell || (shellExecutable && hasCommandStringFlag) || /\b(?:ba|z|da|k|fi)?sh\s+-(?:l)?c\b/i.test(command));
}

function hasOutputCap(command: string): boolean {
  return /\b(head|tail)\b|\bsed\s+-n\b|--max-count\b|\s-m\s+\d+\b|--limit(?:=|\s)|--max-output|\btimeout\s+\d+/i.test(command);
}

function looksHighOutput(command: string): boolean {
  return /\b(cat|find|rg|grep|git\s+(diff|log|show)|ls\s+-R|du\s+-a|tree)\b/i.test(command);
}

function commandIssues(
  loop: Loop,
  target: Loop["target"] | WorkflowStep["target"],
  targetPath: string,
  opts: Required<LintOptions>,
): LoopLintIssue[] {
  const command = commandText(target);
  if (!command) return [];
  const issues: LoopLintIssue[] = [];
  const scrubbed = scrubSecrets(command);
  const base = {
    loopId: loop.id,
    loopName: loop.name,
    targetPath,
    target: scrubbed.length <= 160 ? scrubbed : `${scrubbed.slice(0, 160)}…`,
  };
  if (command.length > opts.longCommandChars) {
    issues.push({
      ...base,
      code: "long-command",
      severity: "warn",
      message: `command is ${command.length} chars`,
      hint: "Move complex behavior into a reviewed script or workflow with bounded structured inputs.",
    });
  }
  if (/\b(?:base64\s+(?:-d|--decode)|openssl\s+base64)\b|[A-Za-z0-9+/]{120,}={0,2}/.test(command)) {
    issues.push({
      ...base,
      code: "inline-base64",
      severity: "error",
      message: "command appears to embed or decode inline base64",
      hint: "Store the payload as an artifact and reference its path instead of embedding it in the command.",
    });
  }
  if (isWrapperShell(target, command)) {
    issues.push({
      ...base,
      code: "wrapper-script",
      severity: "warn",
      message: "command delegates through a generic wrapper shell",
      hint: "Use structured command argv or an explicit workflow step so execution and bounds remain inspectable.",
    });
  }
  if (looksHighOutput(command) && !hasOutputCap(command)) {
    issues.push({
      ...base,
      code: "unbounded-output",
      severity: "warn",
      message: "command may emit unbounded output",
      hint: "Add head, tail, sed -n, --max-count, --limit, or another explicit output bound.",
    });
  }
  return issues;
}

function severityRank(severity: LintSeverity): number {
  return severity === "error" ? 2 : 1;
}

export function lintLoops(
  loops: Loop[],
  workflows: Map<string, WorkflowSpec> = new Map(),
  opts: LintOptions = {},
): Record<string, unknown> {
  const resolved: Required<LintOptions> = {
    longCommandChars: Math.max(1, opts.longCommandChars ?? 500),
  };
  const issues: LoopLintIssue[] = [];
  for (const loop of loops) {
    issues.push(...commandIssues(loop, loop.target, "loop.target", resolved));
    if (loop.target.type !== "workflow") continue;
    const workflow = workflows.get(loop.target.workflowId);
    for (const step of workflow?.steps ?? []) {
      issues.push(...commandIssues(loop, step.target, `workflow:${loop.target.workflowId}:step:${step.id}`, resolved));
    }
  }
  issues.sort((a, b) =>
    severityRank(b.severity) - severityRank(a.severity)
    || a.code.localeCompare(b.code)
    || a.loopName.localeCompare(b.loopName)
    || a.targetPath.localeCompare(b.targetPath));
  return {
    schema: "openloops.lint.v1",
    ok: issues.length === 0,
    summary: {
      loops: loops.length,
      issues: issues.length,
      bySeverity: countBy(issues, (issue) => issue.severity),
      byCode: countBy(issues, (issue) => issue.code),
    },
    issues,
  };
}

export function lintIssueLine(issue: LoopLintIssue): string {
  return `${issue.severity} ${issue.code} loop=${issue.loopId} target=${issue.targetPath} ${issue.message}. ${issue.hint}`;
}
