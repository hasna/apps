#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { Command } from "commander";
import type {
  AccountRef,
  AgentProvider,
  CatchUpPolicy,
  CreateLoopInput,
  Loop,
  LoopTarget,
  OverlapPolicy,
  RunStatus,
  ScheduleSpec,
  WorkflowRun,
  WorkflowStepRun,
  WorkflowSpec,
} from "../types.js";
import { daemonLogPath } from "../lib/paths.js";
import {
  daemonStatusSummary,
  publicLoop,
  publicExecutorResult,
  publicGoal,
  publicGoalRun,
  publicRun,
  publicWorkflow,
  publicWorkflowEvent,
  publicWorkflowRun,
  publicWorkflowStepRun,
  scheduleSummary,
  compactRun,
  targetSummary,
  textOutputBlocks,
  truncateDisplay,
} from "../lib/format.js";
import { parseDuration } from "../lib/schedule.js";
import { Store } from "../lib/store.js";
import { executeWorkflow, preflightWorkflow } from "../lib/workflow-runner.js";
import { advanceLoop, executeClaimedRun, manualRunScheduledFor, manualRunSource, shouldAdvanceManualRun, tick } from "../lib/scheduler.js";
import { daemonStatus, stopDaemon } from "../daemon/control.js";
import { runDaemon, startDaemon } from "../daemon/daemon.js";
import { enableStartup, installStartup } from "../daemon/install.js";
import { workflowBodyFromJson } from "../lib/workflow-spec.js";
import { normalizeGoalSpec } from "../lib/workflow-spec.js";
import { runDoctor } from "../lib/doctor.js";
import { listOpenMachines, resolveLoopMachine } from "../lib/machines.js";
import { packageVersion } from "../lib/version.js";
import { mergeLoopLabels, normalizeLoopLabels, removeLoopLabels } from "../lib/labels.js";
import {
  conciseRunIssue,
  discoveryLoopLine,
  hasProjectFilters,
  loopAccount,
  loopProvider,
  loopTargetCwd,
  matchLoopToProject,
  summaryLine,
  summarizeProjectHealth,
  type ProjectFilter,
  type ProjectLoopEntry,
} from "../lib/project-discovery.js";
import {
  auditLine,
  auditRuns,
  externalArtifact,
  healthLine,
  healthReport,
  lintIssueLine,
  lintLoops,
  receiptLine,
  receiptSummary,
  runArtifactRefs,
  runSummary,
  runSummaryLine,
  type AuditGroupBy,
  type LoopLintIssue,
  type LintSeverity,
} from "../lib/insights.js";

const program = new Command();

program.name("loops").description("Persistent local loops for commands and headless coding agents").version(packageVersion());
program.option("-j, --json", "print JSON");
program.option("-v, --verbose", "show full redacted detail output");

const DEFAULT_HUMAN_LIST_LIMIT = 25;
const DEFAULT_HUMAN_RUN_LIMIT = 20;
const DEFAULT_HUMAN_EVENT_LIMIT = 50;
const DEFAULT_HUMAN_STEP_LIMIT = 50;
const DEFAULT_HUMAN_LOG_LINES = 40;
const DEFAULT_HUMAN_OUTPUT_CHARS = 4_000;
const MAX_HUMAN_OUTPUT_CHARS = 64_000;
const DEFAULT_FILTER_SCAN_CHUNK = 500;

function isJson(): boolean {
  return Boolean(program.opts().json);
}

function isVerbose(opts: CliOpts = {}): boolean {
  return Boolean(opts.verbose || program.opts().verbose);
}

function print(value: unknown, human?: string): void {
  if (isJson() || !human) console.log(JSON.stringify(value, null, 2));
  else console.log(human);
}

function printDetail(value: unknown, human: string, opts: CliOpts = {}): void {
  if (isJson() || isVerbose(opts)) console.log(JSON.stringify(value, null, 2));
  else console.log(human);
}

function printTextOutput(value: { stdout?: string; stderr?: string }, opts: { limit?: number } = {}): void {
  for (const line of textOutputBlocks(value, { indent: "  ", limit: opts.limit ?? DEFAULT_HUMAN_OUTPUT_CHARS })) console.log(line);
}

function addVerboseOption(command: Command): Command {
  return command.option("-v, --verbose", "show full redacted detail output");
}

function parseNonNegativeInteger(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function explicitOutputLimit(opts: CliOpts): number | undefined {
  const source = (opts as CliOpts & { getOptionValueSource?: (key: string) => string | undefined }).getOptionValueSource?.("maxOutputChars");
  if (source !== undefined && source !== "cli" && source !== "env") return undefined;
  const raw = typeof opts.maxOutputChars === "string" ? opts.maxOutputChars : undefined;
  const value = positiveInteger(raw, "--max-output-chars");
  return value === undefined ? undefined : Math.min(value, MAX_HUMAN_OUTPUT_CHARS);
}

function humanOutputLimit(opts: CliOpts): number {
  return explicitOutputLimit(opts) ?? DEFAULT_HUMAN_OUTPUT_CHARS;
}

function jsonOutputLimit(opts: CliOpts): number | undefined {
  return isJson() ? explicitOutputLimit(opts) : humanOutputLimit(opts);
}

function defaultLimit(opts: CliOpts, humanDefault: number, jsonDefault: number): number {
  return positiveInteger(typeof opts.limit === "string" ? opts.limit : undefined, "--limit") ?? (isJson() ? jsonDefault : humanDefault);
}

function pageItems<T>(items: T[], opts: CliOpts, limit: number): { page: T[]; cursor: number; nextCursor?: number } {
  const cursor = parseNonNegativeInteger(typeof opts.cursor === "string" ? opts.cursor : undefined, "--cursor") ?? 0;
  const page = items.slice(cursor, cursor + limit);
  const nextCursor = items.length > cursor + limit ? cursor + limit : undefined;
  return { page, cursor, nextCursor };
}

function printPageHint(noun: string, shown: number, nextCursor: number | undefined, nextCommand: string | undefined, detailHint: string): void {
  const more =
    nextCursor === undefined
      ? ""
      : nextCommand
        ? `; more available: ${nextCommand} --cursor ${nextCursor}`
        : `; more available: repeat this command with --cursor ${nextCursor}`;
  console.log(`showing ${shown} ${noun}${more}. ${detailHint}`);
}

function loopLine(loop: Loop, verbose = false): string {
  const labels = loop.labels?.length ? ` labels=${loop.labels.join(",")}` : "";
  const machine = loop.machine ? ` machine=${loop.machine.id}` : "";
  const goal = loop.goal ? " goal=yes" : "";
  const base = `${loop.id}  ${loop.status.padEnd(7)}  next=${loop.nextRunAt ?? "-"}  ${loop.name}${labels}${machine}${goal}`;
  return verbose ? `${base}  schedule=${scheduleSummary(loop.schedule)}  target=${targetSummary(loop.target)}` : base;
}

function loopDetail(loop: Loop): string {
  return [
    `${loop.id}  ${loop.status}  ${loop.name}`,
    `next=${loop.nextRunAt ?? "-"} retry=${loop.retryScheduledFor ?? "-"} schedule=${scheduleSummary(loop.schedule)}`,
    `target=${targetSummary(loop.target)}`,
    `labels=${loop.labels?.join(",") || "-"} machine=${loop.machine?.id ?? "-"} goal=${loop.goal ? "yes" : "no"}`,
    "Use --verbose or --json for full loop metadata.",
  ].join("\n");
}

function workflowLine(workflow: WorkflowSpec): string {
  const goal = workflow.goal ? " goal=yes" : "";
  return `${workflow.id}  ${workflow.status.padEnd(8)}  steps=${workflow.steps.length}${goal}  ${workflow.name}`;
}

function workflowRunLine(run: WorkflowRun): string {
  const duration = run.durationMs === undefined ? "" : ` duration=${run.durationMs}ms`;
  return `${run.id}  ${run.status.padEnd(10)}  ${run.workflowName}  started=${run.startedAt ?? "-"}${duration}`;
}

function workflowStepLine(step: WorkflowStepRun, verbose = false): string {
  const output = step.stdout || step.stderr ? " output=yes" : "";
  const duration = step.durationMs === undefined ? "" : ` duration=${step.durationMs}ms`;
  const error = step.error ? ` error=${truncateDisplay(String(publicWorkflowStepRun(step).error), verbose ? 180 : 80)}` : "";
  return `  ${String(step.sequence).padStart(2, "0")}  ${step.status.padEnd(10)}  ${step.stepId}${duration}${output}${error}`;
}

function parseSchedule(opts: { at?: string; every?: string; cron?: string; dynamic?: boolean }): ScheduleSpec {
  const count = [opts.at, opts.every, opts.cron, opts.dynamic ? "dynamic" : undefined].filter(Boolean).length;
  if (count !== 1) throw new Error("choose exactly one schedule: --at, --every, --cron, or --dynamic");
  if (opts.at) return { type: "once", at: new Date(opts.at).toISOString() };
  if (opts.every) return { type: "interval", everyMs: parseDuration(opts.every), anchor: "fixed_rate" };
  if (opts.cron) return { type: "cron", expression: opts.cron };
  return { type: "dynamic", minIntervalMs: 60_000 };
}

function positiveInteger(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function positiveDuration(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = parseDuration(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero`);
  return value;
}

type CliOpts = Record<string, string | string[] | boolean | undefined>;

function collectRepeated(value: string, previous: string[]): string[] {
  return [...(previous ?? []), value];
}

function labelsFromOpts(opts: CliOpts): string[] {
  const value = opts.label;
  return normalizeLoopLabels(Array.isArray(value) ? value : typeof value === "string" ? [value] : undefined);
}

function addProjectFilterOptions(command: Command, opts: { includeRepo?: boolean } = {}): Command {
  const withRepo =
    opts.includeRepo === false
      ? command
      : command.option("--repo <pathOrName>", "filter by repository/project path or name").option("--project <pathOrName>", "alias for --repo");
  return withRepo
    .option("--cwd <path>", "filter by loop or workflow working directory")
    .option("--name <text>", "filter by loop name substring")
    .option("--text <text>", "filter by name, description, goal, target, workflow, or metadata text");
}

function trimmedFilterValue(value: string | undefined, flag: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${flag} must not be empty`);
  return trimmed;
}

function projectFilterFromOpts(opts: CliOpts, repoOverride?: string): ProjectFilter {
  if (repoOverride && (typeof opts.repo === "string" || typeof opts.project === "string")) {
    throw new Error("project show takes the repo/project query as a positional argument; do not also pass --repo or --project");
  }
  const repoOption = trimmedFilterValue(typeof opts.repo === "string" ? opts.repo : undefined, "--repo");
  const projectOption = trimmedFilterValue(typeof opts.project === "string" ? opts.project : undefined, "--project");
  const repo = trimmedFilterValue(repoOverride, "<pathOrName>") ?? repoOption ?? projectOption;
  if (repoOption && projectOption && repoOption !== projectOption) {
    throw new Error("--repo and --project must refer to the same project when both are provided");
  }
  return {
    repo,
    cwd: trimmedFilterValue(typeof opts.cwd === "string" ? opts.cwd : undefined, "--cwd"),
    name: trimmedFilterValue(typeof opts.name === "string" ? opts.name : undefined, "--name"),
    text: trimmedFilterValue(typeof opts.text === "string" ? opts.text : undefined, "--text"),
  };
}

function workflowMapForLoops(store: Store, loops: Loop): Map<string, WorkflowSpec>;
function workflowMapForLoops(store: Store, loops: Loop[]): Map<string, WorkflowSpec>;
function workflowMapForLoops(store: Store, loops: Loop | Loop[]): Map<string, WorkflowSpec> {
  const values = Array.isArray(loops) ? loops : [loops];
  const workflows = new Map<string, WorkflowSpec>();
  for (const loop of values) {
    if (loop.target.type !== "workflow" || workflows.has(loop.target.workflowId)) continue;
    const workflow = store.getWorkflow(loop.target.workflowId);
    if (workflow) workflows.set(workflow.id, workflow);
  }
  return workflows;
}

function projectEntries(store: Store, loops: Loop[], filter: ProjectFilter, includeLatestRun: boolean): ProjectLoopEntry[] {
  const workflows = workflowMapForLoops(store, loops);
  const entries: ProjectLoopEntry[] = [];
  const hasFilters = hasProjectFilters(filter);
  for (const loop of loops) {
    const workflow = loop.target.type === "workflow" ? workflows.get(loop.target.workflowId) : undefined;
    const match = hasFilters ? matchLoopToProject(loop, filter, workflow) : undefined;
    if (hasFilters && !match) continue;
    entries.push({
      loop,
      match: match ?? {
        matched: false,
        reasons: [],
        cwd: loopTargetCwd(loop, workflow),
        provider: loopProvider(loop, workflow),
        account: loopAccount(loop, workflow),
      },
    });
  }
  if (!includeLatestRun || entries.length === 0) return entries;
  const latestRuns = store.latestRunsForLoopIds(entries.map((entry) => entry.loop.id));
  return entries.map((entry) => ({ ...entry, latestRun: latestRuns.get(entry.loop.id) }));
}

function attachLatestRuns(store: Store, entries: ProjectLoopEntry[]): ProjectLoopEntry[] {
  if (entries.length === 0) return entries;
  const latestRuns = store.latestRunsForLoopIds(entries.map((entry) => entry.loop.id));
  return entries.map((entry) => ({ ...entry, latestRun: latestRuns.get(entry.loop.id) }));
}

function collectProjectEntries(
  store: Store,
  opts: { filter: ProjectFilter; status?: Loop["status"]; labels: string[]; includeLatestRun: boolean; cursor: number; limit: number },
): ProjectLoopEntry[] {
  if (!hasProjectFilters(opts.filter)) {
    return projectEntries(
      store,
      store.listLoops({ status: opts.status, labels: opts.labels, limit: opts.cursor + opts.limit + 1 }),
      opts.filter,
      opts.includeLatestRun,
    );
  }
  const needed = opts.cursor + opts.limit + 1;
  const entries: ProjectLoopEntry[] = [];
  let offset = 0;
  while (entries.length < needed) {
    const loops = store.listLoops({ status: opts.status, labels: opts.labels, limit: DEFAULT_FILTER_SCAN_CHUNK, offset });
    if (loops.length === 0) break;
    entries.push(...projectEntries(store, loops, opts.filter, false));
    offset += loops.length;
    if (loops.length < DEFAULT_FILTER_SCAN_CHUNK) break;
  }
  return opts.includeLatestRun ? attachLatestRuns(store, entries) : entries;
}

function collectAllProjectEntries(
  store: Store,
  opts: { filter: ProjectFilter; status?: Loop["status"]; labels: string[]; includeLatestRun: boolean },
): ProjectLoopEntry[] {
  const entries: ProjectLoopEntry[] = [];
  let offset = 0;
  while (true) {
    const loops = store.listLoops({ status: opts.status, labels: opts.labels, limit: DEFAULT_FILTER_SCAN_CHUNK, offset });
    if (loops.length === 0) break;
    entries.push(...projectEntries(store, loops, opts.filter, false));
    offset += loops.length;
    if (loops.length < DEFAULT_FILTER_SCAN_CHUNK) break;
  }
  return opts.includeLatestRun ? attachLatestRuns(store, entries) : entries;
}

function workflowMap(store: Store): Map<string, WorkflowSpec> {
  return new Map(store.listWorkflows({ limit: 10_000 }).map((workflow) => [workflow.id, workflow]));
}

function loopMapForRuns(store: Store, runs: { loopId: string }[]): Map<string, Loop> {
  const loops = new Map<string, Loop>();
  for (const run of runs) {
    if (loops.has(run.loopId)) continue;
    const loop = store.getLoop(run.loopId);
    if (loop) loops.set(loop.id, loop);
  }
  return loops;
}

function workflowForLoop(loop: Loop | undefined, workflows: Map<string, WorkflowSpec>): WorkflowSpec | undefined {
  return loop?.target.type === "workflow" ? workflows.get(loop.target.workflowId) : undefined;
}

function parseSince(raw: string | undefined): string {
  if (!raw) return new Date(Date.now() - parseDuration("24h")).toISOString();
  try {
    return new Date(Date.now() - parseDuration(raw)).toISOString();
  } catch {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) throw new Error("--since must be an ISO timestamp or duration such as 24h");
    return date.toISOString();
  }
}

function runStatusFromOpt(value: unknown): RunStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("--status must be a run status");
  if (!["running", "succeeded", "failed", "timed_out", "abandoned", "skipped"].includes(value)) {
    throw new Error("--status must be running, succeeded, failed, timed_out, abandoned, or skipped");
  }
  return value as RunStatus;
}

function auditGroupByFromOpt(value: unknown): AuditGroupBy {
  const groupBy = value === undefined ? "status" : value;
  if (typeof groupBy !== "string" || !["status", "loop", "day", "failure-family"].includes(groupBy)) {
    throw new Error("--group-by must be status, loop, day, or failure-family");
  }
  return groupBy as AuditGroupBy;
}

function severityFromOpt(value: unknown): LintSeverity | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !["info", "warn", "error"].includes(value)) {
    throw new Error("--severity must be info, warn, or error");
  }
  return value as LintSeverity;
}

function projectJsonEntry(entry: ProjectLoopEntry, includeMatch: boolean): Record<string, unknown> {
  return {
    loop: publicLoop(entry.loop),
    latestRun: entry.latestRun
      ? {
          ...compactRun(entry.latestRun),
          error: truncateDisplay(entry.latestRun.error, 240),
        }
      : undefined,
    latestRunIssue: conciseRunIssue(entry.latestRun),
    match: includeMatch ? entry.match : undefined,
  };
}

function parsePolicy(opts: {
  catchUp?: string;
  catchUpLimit?: string;
  overlap?: string;
  attempts?: string;
  retryDelay?: string;
  lease?: string;
}) {
  const catchUp = (opts.catchUp ?? "latest") as CatchUpPolicy;
  if (!["none", "latest", "all"].includes(catchUp)) throw new Error("--catch-up must be none, latest, or all");
  const overlap = (opts.overlap ?? "skip") as OverlapPolicy;
  if (!["skip", "allow"].includes(overlap)) throw new Error("--overlap must be skip or allow");
  return {
    catchUp,
    catchUpLimit: positiveInteger(opts.catchUpLimit, "--catch-up-limit"),
    overlap,
    maxAttempts: positiveInteger(opts.attempts, "--attempts"),
    retryDelayMs: positiveDuration(opts.retryDelay, "--retry-delay"),
    leaseMs: positiveDuration(opts.lease, "--lease"),
  };
}

function baseCreateInput(name: string, opts: CliOpts, target: LoopTarget): CreateLoopInput {
  const schedule = parseSchedule({
    at: typeof opts.at === "string" ? opts.at : undefined,
    every: typeof opts.every === "string" ? opts.every : undefined,
    cron: typeof opts.cron === "string" ? opts.cron : undefined,
    dynamic: Boolean(opts.dynamic),
  });
  const policy = parsePolicy({
    catchUp: typeof opts.catchUp === "string" ? opts.catchUp : undefined,
    catchUpLimit: typeof opts.catchUpLimit === "string" ? opts.catchUpLimit : undefined,
    overlap: typeof opts.overlap === "string" ? opts.overlap : undefined,
    attempts: typeof opts.attempts === "string" ? opts.attempts : undefined,
    retryDelay: typeof opts.retryDelay === "string" ? opts.retryDelay : undefined,
    lease: typeof opts.lease === "string" ? opts.lease : undefined,
  });
  return {
    name,
    description: typeof opts.description === "string" ? opts.description : undefined,
    labels: labelsFromOpts(opts),
    schedule,
    target,
    goal: goalFromOpts(opts),
    machine: typeof opts.machine === "string" ? resolveLoopMachine(opts.machine) : undefined,
    ...policy,
    expiresAt: typeof opts.expiresAt === "string" ? new Date(opts.expiresAt).toISOString() : undefined,
  };
}

function addScheduleOptions(command: Command): Command {
  return command
    .option("--at <time>", "run once at an absolute time")
    .option("--every <duration>", "run at a fixed interval, e.g. 15m, 1h, 30s")
    .option("--cron <expr>", "run on a 5-field cron expression")
    .option("--dynamic", "run on the default dynamic one-minute cadence")
    .option("--catch-up <policy>", "none, latest, or all", "latest")
    .option("--catch-up-limit <n>", "maximum missed slots to run when --catch-up all")
    .option("--overlap <policy>", "skip or allow", "skip")
    .option("--attempts <n>", "max attempts per scheduled slot")
    .option("--retry-delay <duration>", "delay between retries", "1m")
    .option("--lease <duration>", "running lease timeout", "30m")
    .option("--expires-at <time>", "stop scheduling after this time")
    .option("-d, --description <text>", "description");
}

function addLabelOptions(command: Command): Command {
  return command.option("--label <label>", "loop label; repeatable", collectRepeated, []);
}

function addAccountOptions(command: Command): Command {
  return command
    .option("--account <profile>", "OpenAccounts profile name for this target")
    .option("--account-tool <tool>", "OpenAccounts tool id; defaults from provider for agents");
}

function addMachineOptions(command: Command): Command {
  return command.option("--machine <id>", "OpenMachines machine id to assign this loop to");
}

function addGoalOptions(command: Command): Command {
  return command
    .option("--goal <objective>", "wrap this loop target in an AI-SDK goal objective")
    .option("--goal-budget <tokens>", "maximum goal orchestration token budget")
    .option("--goal-model <model>", "OpenRouter model id for goal planning and validation")
    .option("--goal-max-turns <n>", "maximum goal orchestration turns");
}

function goalFromOpts(opts: CliOpts) {
  const hasGoalOption = opts.goal !== undefined || opts.goalBudget !== undefined || opts.goalModel !== undefined || opts.goalMaxTurns !== undefined;
  if (!hasGoalOption) return undefined;
  if (typeof opts.goal !== "string") throw new Error("--goal is required when using goal options");
  return normalizeGoalSpec(
    {
      objective: opts.goal,
      tokenBudget: positiveInteger(typeof opts.goalBudget === "string" ? opts.goalBudget : undefined, "--goal-budget"),
      model: typeof opts.goalModel === "string" ? opts.goalModel : undefined,
      maxTurns: positiveInteger(typeof opts.goalMaxTurns === "string" ? opts.goalMaxTurns : undefined, "--goal-max-turns"),
      autoExecute: "readyOnly",
    },
    "goal",
  );
}

function accountFromOpts(opts: { account?: string; accountTool?: string }): AccountRef | undefined {
  if (!opts.account && opts.accountTool) throw new Error("--account-tool requires --account");
  return opts.account ? { profile: opts.account, tool: opts.accountTool } : undefined;
}

function providerAuthProfileFromOpts(opts: { authProfile?: string }, provider: AgentProvider): string | undefined {
  if (!opts.authProfile) return undefined;
  if (provider !== "codewith") throw new Error("--auth-profile is currently supported only for --provider codewith");
  return opts.authProfile;
}

const create = program.command("create").description("create loops");

addGoalOptions(
  addAccountOptions(
    addMachineOptions(
      addScheduleOptions(
        addLabelOptions(
          create
            .command("command <name>")
            .description("create a deterministic shell command loop")
            .requiredOption("--cmd <command>", "command string to execute")
            .option("--cwd <dir>", "working directory")
            .option("--timeout <duration>", "run timeout")
            .option("--no-shell", "execute without a shell"),
        ),
      ),
    ),
  ),
).action((name, opts) => {
  const store = new Store();
  try {
    const target: LoopTarget = {
      type: "command",
      command: opts.cmd,
      cwd: opts.cwd,
      shell: opts.shell,
      timeoutMs: opts.timeout ? parseDuration(opts.timeout) : undefined,
      account: accountFromOpts(opts),
    };
    const loop = store.createLoop(baseCreateInput(name, opts, target));
    print(publicLoop(loop), `created loop ${loop.id} (${loop.name}) next=${loop.nextRunAt}`);
  } finally {
    store.close();
  }
});

addGoalOptions(
  addAccountOptions(
    addMachineOptions(
      addScheduleOptions(
        addLabelOptions(
          create
            .command("agent <name>")
            .description("create a headless coding-agent loop")
            .requiredOption("--provider <provider>", "claude, cursor, codewith, aicopilot, opencode, or codex")
            .requiredOption("--prompt <prompt>", "agent prompt")
            .option("--cwd <dir>", "working directory")
            .option("--model <model>", "model")
            .option("--agent <agent>", "provider-specific agent")
            .option("--auth-profile <profile>", "provider-native auth profile; currently supported for codewith")
            .option("--timeout <duration>", "run timeout")
            .option("--sandbox <mode>", "agent sandbox for providers that support it: read-only, workspace-write, or danger-full-access")
            .option("--config-isolation <mode>", "safe or none", "safe"),
        ),
      ),
    ),
  ),
).action((name, opts) => {
  const provider = opts.provider as AgentProvider;
  if (!["claude", "cursor", "codewith", "aicopilot", "opencode", "codex"].includes(provider)) {
    throw new Error("unsupported provider");
  }
  if (!["safe", "none"].includes(opts.configIsolation)) {
    throw new Error("--config-isolation must be safe or none");
  }
  if (opts.sandbox && !["read-only", "workspace-write", "danger-full-access"].includes(opts.sandbox)) {
    throw new Error("--sandbox must be read-only, workspace-write, or danger-full-access");
  }
  const store = new Store();
  try {
    const target: LoopTarget = {
      type: "agent",
      provider,
      prompt: opts.prompt,
      cwd: opts.cwd,
      model: opts.model,
      agent: opts.agent,
      authProfile: providerAuthProfileFromOpts(opts, provider),
      timeoutMs: opts.timeout ? parseDuration(opts.timeout) : undefined,
      configIsolation: opts.configIsolation,
      sandbox: opts.sandbox,
      account: accountFromOpts(opts),
    };
    const loop = store.createLoop(baseCreateInput(name, opts, target));
    print(publicLoop(loop), `created loop ${loop.id} (${loop.name}) next=${loop.nextRunAt}`);
  } finally {
    store.close();
  }
});

addGoalOptions(
  addMachineOptions(
    addScheduleOptions(
      addLabelOptions(
        create
          .command("workflow <name>")
          .description("schedule a stored workflow")
          .requiredOption("--workflow <idOrName>", "workflow id or name"),
      ),
    ),
  ),
).action((name, opts) => {
  const store = new Store();
  try {
    const workflow = store.requireWorkflow(opts.workflow);
    const target: LoopTarget = {
      type: "workflow",
      workflowId: workflow.id,
    };
    const loop = store.createLoop(baseCreateInput(name, opts, target));
    print(publicLoop(loop), `created workflow loop ${loop.id} (${loop.name}) workflow=${workflow.name} next=${loop.nextRunAt}`);
  } finally {
    store.close();
  }
});

const workflows = program.command("workflows").alias("workflow").description("manage workflow specs and runs");

const machines = program.command("machines").description("inspect OpenMachines topology for loop assignment");

const goal = program.command("goal").description("inspect goal runs");

addVerboseOption(goal.command("show <idOrName>").description("show a goal or configured loop/workflow goal").option("--limit <n>", "goal run limit")).action((idOrName, opts) => {
  const store = new Store();
  try {
    const runtimeGoal = store.getGoal(idOrName) ?? store.findGoalByLoop(idOrName);
    if (runtimeGoal) {
      const runs = store.listGoalRuns({ goalId: runtimeGoal.goalId, limit: defaultLimit(opts, DEFAULT_HUMAN_RUN_LIMIT, 200) });
      const value = {
        goal: publicGoal(runtimeGoal),
        nodes: store.listGoalPlanNodes(runtimeGoal.goalId),
        runs: runs.map(publicGoalRun),
      };
      printDetail(
        value,
        [
          `${runtimeGoal.goalId} ${runtimeGoal.status} tokens=${runtimeGoal.tokensUsed}${runtimeGoal.tokenBudget ? `/${runtimeGoal.tokenBudget}` : ""}`,
          truncateDisplay(runtimeGoal.objective, 180) ?? "",
          `runs=${runs.length}. Use --verbose or --json for plan nodes and run evidence.`,
        ].join("\n"),
        opts,
      );
      return;
    }
    const loop = store.getLoop(idOrName) ?? store.findLoopByName(idOrName);
    if (loop?.goal) {
      printDetail({ config: loop.goal, loop: publicLoop(loop) }, `configured goal for loop ${loop.name}: ${truncateDisplay(loop.goal.objective, 180)}`, opts);
      return;
    }
    const workflow = store.getWorkflow(idOrName) ?? store.findWorkflowByName(idOrName);
    if (workflow?.goal) {
      printDetail(
        { config: workflow.goal, workflow: publicWorkflow(workflow) },
        `configured goal for workflow ${workflow.name}: ${truncateDisplay(workflow.goal.objective, 180)}`,
        opts,
      );
      return;
    }
    throw new Error(`goal not found: ${idOrName}`);
  } finally {
    store.close();
  }
});

addVerboseOption(goal.command("status <runId>").description("show goal status for a goal, goal event, loop run, or workflow run").option("--limit <n>", "goal run limit")).action((runId, opts) => {
  const store = new Store();
  try {
    const runtimeGoal = store.findGoalByRunId(runId);
    if (!runtimeGoal) throw new Error(`goal run not found: ${runId}`);
      const runs = store.listGoalRuns({ goalId: runtimeGoal.goalId, limit: defaultLimit(opts, DEFAULT_HUMAN_RUN_LIMIT, 200) });
    const value = {
      goal: publicGoal(runtimeGoal),
      nodes: store.listGoalPlanNodes(runtimeGoal.goalId),
      runs: runs.map(publicGoalRun),
    };
    printDetail(
      value,
      `${runtimeGoal.goalId} ${runtimeGoal.status} tokens=${runtimeGoal.tokensUsed} runs=${runs.length}\nUse --verbose or --json for plan nodes and run evidence.`,
      opts,
    );
  } finally {
    store.close();
  }
});

machines
  .command("list")
  .alias("ls")
  .description("list known machines")
  .option("--limit <n>", "maximum machines to show")
  .option("--cursor <offset>", "zero-based offset for the next page")
  .action((opts) => {
    const values = listOpenMachines();
    const limit = defaultLimit(opts, DEFAULT_HUMAN_LIST_LIMIT, 200);
    const { page, nextCursor } = pageItems(values, opts, limit);
    if (isJson()) print(page);
    else {
      for (const machine of page) {
        const route = machine.local ? "local" : machine.route ?? "-";
        console.log(`${machine.id.padEnd(12)}  ${route.padEnd(10)}  workspace=${machine.workspacePath ?? "-"}  host=${machine.hostname ?? "-"}`);
      }
      printPageHint("machines", page.length, nextCursor, "loops machines list", "Use `loops machines show <id>` for details.");
    }
  });

addVerboseOption(machines.command("show <id>").description("resolve a machine assignment")).action((id, opts) => {
  const machine = resolveLoopMachine(id);
  const route = machine.local ? "local" : machine.route ?? "-";
  printDetail(machine, `${machine.id} route=${route} local=${Boolean(machine.local)} workspace=${machine.workspacePath ?? "-"}\nUse --verbose or --json for full machine metadata.`, opts);
});

workflows
  .command("validate <file>")
  .description("validate a workflow JSON file without storing or running it")
  .option("--name <name>", "override workflow name from the file")
  .option("--preflight", "also check account env and target executables")
  .action((file, opts) => {
    const body = workflowBodyFromJson(JSON.parse(readFileSync(file, "utf8")), opts.name);
    const now = new Date().toISOString();
    const workflow = {
      id: "validation",
      name: body.name,
      description: body.description,
      version: body.version ?? 1,
      status: "active" as const,
      goal: body.goal,
      steps: body.steps,
      createdAt: now,
      updatedAt: now,
    };
    const preflight = opts.preflight ? preflightWorkflow(workflow) : undefined;
    print({ valid: true, workflow: publicWorkflow(workflow), preflight }, `valid workflow ${workflow.name} steps=${workflow.steps.length}`);
  });

workflows
  .command("create <file>")
  .description("validate and store a workflow JSON file")
  .option("--name <name>", "override workflow name from the file")
  .action((file, opts) => {
    const store = new Store();
    try {
      const body = workflowBodyFromJson(JSON.parse(readFileSync(file, "utf8")), opts.name);
      const workflow = store.createWorkflow(body);
      print(publicWorkflow(workflow), `created workflow ${workflow.id} (${workflow.name}) steps=${workflow.steps.length}`);
    } finally {
      store.close();
    }
  });

workflows
  .command("list")
  .alias("ls")
  .option("--status <status>", "active or archived", "active")
  .option("--limit <n>", "maximum workflows to show")
  .option("--cursor <offset>", "zero-based offset for the next page")
  .action((opts) => {
    const store = new Store();
    try {
      const limit = defaultLimit(opts, DEFAULT_HUMAN_LIST_LIMIT, 200);
      const cursor = parseNonNegativeInteger(typeof opts.cursor === "string" ? opts.cursor : undefined, "--cursor") ?? 0;
      const workflowsList = store.listWorkflows({ status: opts.status, limit: cursor + limit + 1 });
      const { page, nextCursor } = pageItems(workflowsList, opts, limit);
      if (isJson()) print(page.map(publicWorkflow));
      else {
        for (const workflow of page) console.log(workflowLine(workflow));
        printPageHint("workflows", page.length, nextCursor, "loops workflows list", "Use `loops workflows show <id>` for details.");
      }
    } finally {
      store.close();
    }
  });

addVerboseOption(workflows.command("show <idOrName>")).action((idOrName, opts) => {
  const store = new Store();
  try {
    const workflow = store.requireWorkflow(idOrName);
    printDetail(
      publicWorkflow(workflow),
      [
        workflowLine(workflow),
        workflow.description ? `description=${truncateDisplay(workflow.description, 180)}` : "description=-",
        `updated=${workflow.updatedAt}`,
        "Use --verbose or --json for full workflow steps.",
      ].join("\n"),
      opts,
    );
  } finally {
    store.close();
  }
});

addVerboseOption(
  workflows
    .command("inspect <runId>")
    .description("show a workflow run with steps and events")
    .option("--steps-limit <n>", "maximum steps to show in compact human output")
    .option("--events-limit <n>", "maximum events to include"),
).action((runId, opts) => {
  const store = new Store();
  try {
    const run = store.requireWorkflowRun(runId);
    const steps = store.listWorkflowStepRuns(run.id);
    const stepLimit = positiveInteger(typeof opts.stepsLimit === "string" ? opts.stepsLimit : undefined, "--steps-limit") ?? DEFAULT_HUMAN_STEP_LIMIT;
    const shownSteps = steps.slice(0, stepLimit);
    const eventsLimit = defaultLimit({ limit: opts.eventsLimit }, DEFAULT_HUMAN_EVENT_LIMIT, 200);
    const events = store.listWorkflowEvents(run.id, eventsLimit);
    const value = {
      workflowRun: publicWorkflowRun(run),
      steps: steps.map((step) => publicWorkflowStepRun(step)),
      events: events.map(publicWorkflowEvent),
    };
    if (isJson() || isVerbose(opts)) print(value);
    else {
      console.log(workflowRunLine(run));
      for (const step of shownSteps) {
        console.log(workflowStepLine(step));
      }
      const stepHint = steps.length > shownSteps.length ? ` steps=${shownSteps.length}/${steps.length}; use --steps-limit ${steps.length} for all steps.` : ` steps=${shownSteps.length}.`;
      console.log(`  events=${events.length}.${stepHint} Use --verbose or --json for redacted event payloads.`);
    }
  } finally {
    store.close();
  }
});

workflows
  .command("run <idOrName>")
  .option("--show-output", "show step stdout/stderr")
  .option("--max-output-chars <n>", `maximum stdout/stderr characters to print; human default ${DEFAULT_HUMAN_OUTPUT_CHARS}`)
  .option("--steps-limit <n>", "maximum steps to show in compact human output")
  .action(async (idOrName, opts) => {
    const store = new Store();
    try {
      const workflow = store.requireWorkflow(idOrName);
      const result = await executeWorkflow(store, workflow);
      const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
      const steps = run ? store.listWorkflowStepRuns(run.id) : [];
      const stepLimit = positiveInteger(typeof opts.stepsLimit === "string" ? opts.stepsLimit : undefined, "--steps-limit") ?? DEFAULT_HUMAN_STEP_LIMIT;
      const shownSteps = steps.slice(0, stepLimit);
      const maxOutputChars = jsonOutputLimit(opts);
      const value = {
        result: publicExecutorResult(result, opts.showOutput, maxOutputChars),
        workflowRun: run ? publicWorkflowRun(run) : undefined,
        steps: steps.map((step) => publicWorkflowStepRun(step, opts.showOutput, maxOutputChars)),
      };
      if (isJson()) print(value);
      else {
        console.log(`${run?.id ?? workflow.id} ${result.status}`);
        for (const step of shownSteps) {
          console.log(workflowStepLine(step));
          if (opts.showOutput) printTextOutput(step, { limit: humanOutputLimit(opts) });
        }
        if (steps.length > shownSteps.length) {
          console.log(`  steps=${shownSteps.length}/${steps.length}; use --steps-limit ${steps.length} for all steps.`);
        }
      }
    } finally {
      store.close();
    }
  });

workflows
  .command("runs [idOrName]")
  .option("--limit <n>", "maximum runs to show")
  .option("--cursor <offset>", "zero-based offset for the next page")
  .action((idOrName, opts) => {
    const store = new Store();
    try {
      const workflow = idOrName ? store.requireWorkflow(idOrName) : undefined;
      const limit = defaultLimit(opts, DEFAULT_HUMAN_RUN_LIMIT, 50);
      const cursor = parseNonNegativeInteger(typeof opts.cursor === "string" ? opts.cursor : undefined, "--cursor") ?? 0;
      const runs = store.listWorkflowRuns({ workflowId: workflow?.id, limit: cursor + limit + 1 });
      const { page, nextCursor } = pageItems(runs, opts, limit);
      if (isJson()) print(page.map(publicWorkflowRun));
      else {
        for (const run of page) console.log(workflowRunLine(run));
        printPageHint("workflow runs", page.length, nextCursor, "loops workflows runs", "Use `loops workflows inspect <run-id>` for steps/events.");
      }
    } finally {
      store.close();
    }
  });

workflows
  .command("events <runId>")
  .option("--limit <n>", "maximum events to show")
  .option("--cursor <offset>", "zero-based offset for the next page")
  .action((runId, opts) => {
    const store = new Store();
    try {
      const limit = defaultLimit(opts, DEFAULT_HUMAN_EVENT_LIMIT, 200);
      const cursor = parseNonNegativeInteger(typeof opts.cursor === "string" ? opts.cursor : undefined, "--cursor") ?? 0;
      const events = store.listWorkflowEvents(runId, cursor + limit + 1);
      const { page, nextCursor } = pageItems(events, opts, limit);
      if (isJson()) print(page.map(publicWorkflowEvent));
      else {
        for (const event of page) {
          console.log(`${String(event.sequence).padStart(3, "0")}  ${event.eventType.padEnd(14)}  ${event.stepId ?? "-"}  ${event.createdAt}`);
        }
        printPageHint("workflow events", page.length, nextCursor, "loops workflows events <run-id>", "Use --json for redacted event payloads.");
      }
    } finally {
      store.close();
    }
  });

workflows
  .command("cancel <runId>")
  .description("mark a workflow run cancelled and cancel pending/running steps")
  .option("--reason <reason>", "cancellation reason", "cancelled by user")
  .action((runId, opts) => {
    const store = new Store();
    try {
      const run = store.cancelWorkflowRun(runId, opts.reason);
      print(publicWorkflowRun(run), `${run.id} ${run.status}`);
    } finally {
      store.close();
    }
  });

workflows
  .command("recover <runId>")
  .description("reset interrupted running workflow steps to pending")
  .option("--reason <reason>", "recovery reason", "manual recovery")
  .action((runId, opts) => {
    const store = new Store();
    try {
      const result = store.recoverWorkflowRun(runId, opts.reason);
      print(
        {
          workflowRun: publicWorkflowRun(result.run),
          recoveredSteps: result.recoveredSteps.map((step) => publicWorkflowStepRun(step)),
        },
        `${result.run.id} recovered=${result.recoveredSteps.length}`,
      );
    } finally {
      store.close();
    }
  });

workflows.command("archive <idOrName>").action((idOrName) => {
  const store = new Store();
  try {
    const workflow = store.archiveWorkflow(idOrName);
    print(publicWorkflow(workflow), `${workflow.id} ${workflow.status}`);
  } finally {
    store.close();
  }
});

addProjectFilterOptions(
  program
    .command("list")
    .alias("ls")
    .option("--status <status>", "filter by status")
    .option("--label <label>", "filter by label; repeatable", collectRepeated, [])
    .option("--limit <n>", "maximum loops to show")
    .option("--cursor <offset>", "zero-based offset for the next page")
    .option("--with-latest-run", "include each loop's latest run status in list output")
    .option("-v, --verbose", "show schedule and target summaries")
    .addHelpText(
      "after",
      "\nExamples:\n  loops list --repo /path/to/repo\n  loops list --repo open-codewith --with-latest-run --json\n  loops list --cwd /path/to/repo --name review\n",
    ),
).action((opts) => {
  const store = new Store();
  try {
    const limit = defaultLimit(opts, DEFAULT_HUMAN_LIST_LIMIT, 200);
    const cursor = parseNonNegativeInteger(typeof opts.cursor === "string" ? opts.cursor : undefined, "--cursor") ?? 0;
    const filter = projectFilterFromOpts(opts);
    const hasFilters = hasProjectFilters(filter);
    const includeLatestRun = Boolean(opts.withLatestRun) || (!isJson() && hasFilters);
    const entries = collectProjectEntries(store, {
      filter,
      status: opts.status,
      labels: labelsFromOpts(opts),
      includeLatestRun,
      cursor,
      limit,
    });
    const { page, nextCursor } = pageItems(entries, opts, limit);
    if (isJson()) {
      if (opts.withLatestRun) print(page.map((entry) => projectJsonEntry(entry, hasFilters)));
      else print(page.map((entry) => publicLoop(entry.loop)));
    } else {
      for (const entry of page) {
        if (includeLatestRun || hasFilters) console.log(discoveryLoopLine(entry));
        else console.log(loopLine(entry.loop, isVerbose(opts)));
      }
      const detailHint = hasFilters
        ? "Use `loops project show <repo>` for a health summary, or --json for scriptable output."
        : "Use `loops show <id>` for details.";
      printPageHint("loops", page.length, nextCursor, hasFilters ? undefined : "loops list", detailHint);
    }
  } finally {
    store.close();
  }
});

addVerboseOption(program.command("show <idOrName>")).action((idOrName, opts) => {
  const store = new Store();
  try {
    const loop = store.requireLoop(idOrName);
    printDetail(publicLoop(loop), loopDetail(loop), opts);
  } finally {
    store.close();
  }
});

addProjectFilterOptions(
  program
    .command("project")
    .alias("projects")
    .description("show loops and latest-run health for a repo/project")
    .command("show <pathOrName>")
    .option("--status <status>", "filter by loop status")
    .option("--label <label>", "filter by label; repeatable", collectRepeated, [])
    .option("--limit <n>", "maximum loops to show")
    .option("--cursor <offset>", "zero-based offset for the next page")
    .addHelpText(
      "after",
      "\nExamples:\n  loops project show /home/hasna/workspace/hasna/opensource/open-codewith\n  loops project show open-codewith --json\n",
    ),
  { includeRepo: false },
).action((pathOrName, opts) => {
  const store = new Store();
  try {
    const limit = defaultLimit(opts, DEFAULT_HUMAN_LIST_LIMIT, 200);
    const cursor = parseNonNegativeInteger(typeof opts.cursor === "string" ? opts.cursor : undefined, "--cursor") ?? 0;
    const filter = projectFilterFromOpts(opts, pathOrName);
    const entries = collectAllProjectEntries(store, {
      filter,
      status: opts.status,
      labels: labelsFromOpts(opts),
      includeLatestRun: true,
    });
    const summary = summarizeProjectHealth(entries);
    const { page, nextCursor } = pageItems(entries, opts, limit);
    if (isJson()) {
      print({
        query: pathOrName,
        cursor,
        nextCursor,
        summary,
        loops: page.map((entry) => projectJsonEntry(entry, true)),
      });
      return;
    }
    console.log(`project=${pathOrName} ${summaryLine(summary)}`);
    for (const entry of page) console.log(discoveryLoopLine(entry));
    printPageHint("loops", page.length, nextCursor, undefined, "Use --json for scriptable match reasons and latest-run fields.");
  } finally {
    store.close();
  }
});

addProjectFilterOptions(
  program
    .command("health [pathOrName]")
    .description("show compact latest-run health for loops matching a project, cwd, name, or text")
    .option("--status <status>", "filter by loop status")
    .option("--label <label>", "filter by label; repeatable", collectRepeated, [])
    .option("--limit <n>", "maximum loops to show")
    .option("--cursor <offset>", "zero-based offset for the next page")
    .option("--show-output", "include bounded latest-run output previews in JSON")
    .option("--max-output-chars <n>", "maximum latest-run output preview characters"),
).action((pathOrName, opts) => {
  const store = new Store();
  try {
    const limit = defaultLimit(opts, DEFAULT_HUMAN_LIST_LIMIT, 200);
    const cursor = parseNonNegativeInteger(typeof opts.cursor === "string" ? opts.cursor : undefined, "--cursor") ?? 0;
    const filter = projectFilterFromOpts(opts, typeof pathOrName === "string" ? pathOrName : undefined);
    const entries = collectAllProjectEntries(store, {
      filter,
      status: opts.status,
      labels: labelsFromOpts(opts),
      includeLatestRun: true,
    });
    const { page, nextCursor } = pageItems(entries, opts, limit);
    const report = {
      ...healthReport(entries, { includeLoops: false }),
      cursor,
      nextCursor,
      loops: healthReport(page, { showOutput: Boolean(opts.showOutput), maxOutputChars: explicitOutputLimit(opts) }).loops,
    };
    if (isJson()) print(report);
    else {
      console.log(healthLine(report));
      for (const entry of page) console.log(discoveryLoopLine(entry));
      printPageHint("loops", page.length, nextCursor, undefined, "Use --json for compact summary schema and artifact refs.");
    }
  } finally {
    store.close();
  }
});

program
  .command("audit")
  .description("summarize recent loop runs with compact drill-down ids")
  .option("--since <timeOrDuration>", "ISO timestamp or duration ago, e.g. 24h", "24h")
  .option("--group-by <field>", "status, loop, day, or failure-family", "status")
  .option("--status <status>", "filter by run status")
  .option("--limit <n>", "maximum runs to scan")
  .option("--drill-down-limit <n>", "maximum run ids to include per group")
  .action((opts) => {
    const store = new Store();
    try {
      const since = parseSince(typeof opts.since === "string" ? opts.since : undefined);
      const status = runStatusFromOpt(opts.status);
      const limit = defaultLimit(opts, DEFAULT_HUMAN_RUN_LIMIT, 1_000);
      const drillDownLimit = positiveInteger(typeof opts.drillDownLimit === "string" ? opts.drillDownLimit : undefined, "--drill-down-limit") ?? 25;
      const runs = store.listRunsSince({ since, status, limit: limit + 1 });
      const value = auditRuns(runs.slice(0, limit), {
        since,
        status,
        groupBy: auditGroupByFromOpt(opts.groupBy),
        drillDownLimit,
        scanLimit: limit,
        hasMore: runs.length > limit,
      });
      if (isJson()) print(value);
      else {
        console.log(auditLine(value));
        for (const group of value.groups as Array<{ key: string; count: number; runIds: string[]; truncated?: boolean }>) {
          console.log(`${group.key} count=${group.count} runIds=${group.runIds.join(",")}${group.truncated ? " truncated=yes" : ""}`);
        }
      }
    } finally {
      store.close();
    }
  });

addProjectFilterOptions(
  program
    .command("lint")
    .description("detect wrapper-script, inline-base64, long-command, unbounded-output, and duplicate-name loop hazards")
    .option("--status <status>", "filter by loop status")
    .option("--label <label>", "filter by label; repeatable", collectRepeated, [])
    .option("--severity <severity>", "filter by issue severity: info, warn, or error")
    .option("--long-command-chars <n>", "long command threshold", "500")
    .option("--limit <n>", "maximum issues to show")
    .option("--cursor <offset>", "zero-based offset for the next issue page"),
).action((opts) => {
  const store = new Store();
  try {
    const limit = defaultLimit(opts, DEFAULT_HUMAN_LIST_LIMIT, 200);
    const cursor = parseNonNegativeInteger(typeof opts.cursor === "string" ? opts.cursor : undefined, "--cursor") ?? 0;
    const severity = severityFromOpt(opts.severity);
    const entries = collectAllProjectEntries(store, {
      filter: projectFilterFromOpts(opts),
      status: opts.status,
      labels: labelsFromOpts(opts),
      includeLatestRun: false,
    });
    const raw = lintLoops(entries.map((entry) => entry.loop), workflowMap(store), {
      longCommandChars: positiveInteger(typeof opts.longCommandChars === "string" ? opts.longCommandChars : undefined, "--long-command-chars") ?? 500,
    });
    const allIssues = raw.issues as LoopLintIssue[];
    const filtered = severity ? allIssues.filter((issue) => issue.severity === severity) : allIssues;
    const page = filtered.slice(cursor, cursor + limit);
    const nextCursor = filtered.length > cursor + limit ? cursor + limit : undefined;
    const value = { ...raw, cursor, nextCursor, issuesTotal: filtered.length, issues: page };
    if (isJson()) print(value);
    else {
      console.log(`lint ok=${raw.ok} issues=${filtered.length}`);
      for (const issue of page) console.log(lintIssueLine(issue));
      printPageHint("issues", page.length, nextCursor, "loops lint", "Use --json for stable issue records and drill-down ids.");
    }
  } finally {
    store.close();
  }
});

const receipts = program.command("receipts").description("append and list structured run receipts");

receipts
  .command("append <runId>")
  .description("append a structured receipt for a loop run")
  .option("--task-id <id>", "linked task id")
  .option("--conversation-id <id>", "linked conversation id")
  .option("--knowledge-id <id>", "linked knowledge id")
  .option("--artifact <ref>", "extra artifact ref; repeatable", collectRepeated, [])
  .option("--show-output", "accepted for compatibility; receipts store output refs, not previews")
  .option("--max-output-chars <n>", "accepted for compatibility; receipts store output refs, not previews")
  .action((runId, opts) => {
    const store = new Store();
    try {
      const run = store.requireRun(runId);
      const loop = store.requireLoop(run.loopId);
      const workflows = workflowMap(store);
      const extraArtifacts = (Array.isArray(opts.artifact) ? opts.artifact : []).map(externalArtifact);
      const summary = runSummary(run, {
        loop,
        workflow: workflowForLoop(loop, workflows),
        showOutput: false,
      });
      const receipt = store.appendRunReceipt({
        runId: run.id,
        taskId: opts.taskId,
        conversationId: opts.conversationId,
        knowledgeId: opts.knowledgeId,
        artifactRefs: runArtifactRefs(run, extraArtifacts),
        summary,
      });
      print(receiptSummary(receipt), receiptLine(receipt));
    } finally {
      store.close();
    }
  });

receipts
  .command("list [runId]")
  .description("list structured run receipts")
  .option("--loop-id <id>", "filter by loop id")
  .option("--task-id <id>", "filter by task id")
  .option("--limit <n>", "maximum receipts to show")
  .option("--cursor <offset>", "zero-based offset for the next page")
  .action((runId, opts) => {
    const store = new Store();
    try {
      const limit = defaultLimit(opts, DEFAULT_HUMAN_RUN_LIMIT, 200);
      const cursor = parseNonNegativeInteger(typeof opts.cursor === "string" ? opts.cursor : undefined, "--cursor") ?? 0;
      const values = store.listRunReceipts({
        runId: typeof runId === "string" ? runId : undefined,
        loopId: opts.loopId,
        taskId: opts.taskId,
        limit: limit + 1,
        offset: cursor,
      });
      const page = values.slice(0, limit);
      const nextCursor = values.length > limit ? cursor + limit : undefined;
      if (isJson()) print({ receipts: page.map(receiptSummary), cursor, nextCursor, hasMore: nextCursor !== undefined });
      else {
        for (const receipt of page) console.log(receiptLine(receipt));
        printPageHint("receipts", page.length, nextCursor, "loops receipts list", "Use --json for artifact refs and stored summary.");
      }
    } finally {
      store.close();
    }
  });

addProjectFilterOptions(
  program
    .command("runs [idOrName]")
    .option("--limit <n>", "maximum runs to show")
    .option("--cursor <offset>", "zero-based offset for the next page")
    .option("--label <label>", "filter by loop label; repeatable", collectRepeated, [])
    .option("--status <status>", "filter by run status")
    .option("--summary", "return compact bounded run summaries with output artifact refs")
    .option("--show-output", "show stdout/stderr")
    .option("--max-output-chars <n>", `maximum stdout/stderr characters to print; human default ${DEFAULT_HUMAN_OUTPUT_CHARS}`)
    .addHelpText(
      "after",
      "\nExamples:\n  loops runs --repo /path/to/repo --limit 10\n  loops runs --repo open-codewith --show-output --max-output-chars 2000\n",
    ),
).action((idOrName, opts) => {
  const store = new Store();
  try {
    const filter = projectFilterFromOpts(opts);
    if (idOrName && hasProjectFilters(filter)) throw new Error("pass either a loop id/name or repo/cwd/name/text filters, not both");
    const loop = idOrName ? store.requireLoop(idOrName) : undefined;
    const limit = defaultLimit(opts, DEFAULT_HUMAN_RUN_LIMIT, 50);
    const cursor = parseNonNegativeInteger(typeof opts.cursor === "string" ? opts.cursor : undefined, "--cursor") ?? 0;
    let runs: ReturnType<Store["listRuns"]>;
    if (hasProjectFilters(filter)) {
      const entries = collectAllProjectEntries(store, {
        filter,
        labels: labelsFromOpts(opts),
        includeLatestRun: false,
      });
      runs = store.listRunsForLoopIds({ loopIds: entries.map((entry) => entry.loop.id), status: opts.status, limit: cursor + limit + 1 });
    } else {
      runs = store.listRuns({ loopId: loop?.id, labels: labelsFromOpts(opts), status: opts.status, limit: cursor + limit + 1 });
    }
    const { page, nextCursor } = pageItems(runs, opts, limit);
    if (opts.summary) {
      const loops = loopMapForRuns(store, page);
      const workflows = workflowMap(store);
      const summaries = page.map((run) => {
        const summaryLoop = loops.get(run.loopId);
        return runSummary(run, {
          loop: summaryLoop,
          workflow: workflowForLoop(summaryLoop, workflows),
          showOutput: Boolean(opts.showOutput),
          maxOutputChars: explicitOutputLimit(opts),
        });
      });
      if (isJson()) print(summaries);
      else {
        for (const summary of summaries) console.log(runSummaryLine(summary));
        printPageHint("run summaries", page.length, nextCursor, hasProjectFilters(filter) || idOrName ? undefined : "loops runs --summary", "Use --json for artifact refs and token details.");
      }
    } else if (isJson()) print(page.map((run) => publicRun(run, opts.showOutput, jsonOutputLimit(opts))));
    else {
      for (const run of page) {
        const hasOutput = run.stdout || run.stderr ? " output=yes" : "";
        console.log(`${run.id}  ${run.status.padEnd(10)}  attempt=${run.attempt}  slot=${run.scheduledFor}  ${run.loopName}${hasOutput}`);
        if (opts.showOutput) printTextOutput(run, { limit: humanOutputLimit(opts) });
      }
      printPageHint("runs", page.length, nextCursor, hasProjectFilters(filter) || idOrName ? undefined : "loops runs", "Use --show-output for bounded stdout/stderr.");
    }
  } finally {
    store.close();
  }
});

program.command("pause <idOrName>").action((idOrName) => updateStatus(idOrName, "paused"));
program.command("resume <idOrName>").action((idOrName) => updateStatus(idOrName, "active"));
program.command("stop <idOrName>").action((idOrName) => updateStatus(idOrName, "stopped"));

const labels = program.command("labels").description("manage loop labels");

labels
  .command("set <idOrName> [labels...]")
  .description("replace loop labels")
  .action((idOrName, nextLabels) => {
    const store = new Store();
    try {
      const loop = store.requireLoop(idOrName);
      const updated = store.updateLoop(loop.id, { labels: normalizeLoopLabels(nextLabels ?? []) });
      print(publicLoop(updated), `${updated.id} labels=${updated.labels?.join(",") ?? ""}`);
    } finally {
      store.close();
    }
  });

labels
  .command("add <idOrName> <labels...>")
  .description("add loop labels")
  .action((idOrName, addedLabels) => {
    const store = new Store();
    try {
      const loop = store.requireLoop(idOrName);
      const updated = store.updateLoop(loop.id, { labels: mergeLoopLabels(loop.labels, addedLabels) });
      print(publicLoop(updated), `${updated.id} labels=${updated.labels?.join(",") ?? ""}`);
    } finally {
      store.close();
    }
  });

labels
  .command("remove <idOrName> <labels...>")
  .alias("rm")
  .description("remove loop labels")
  .action((idOrName, removedLabels) => {
    const store = new Store();
    try {
      const loop = store.requireLoop(idOrName);
      const updated = store.updateLoop(loop.id, { labels: removeLoopLabels(loop.labels, removedLabels) });
      print(publicLoop(updated), `${updated.id} labels=${updated.labels?.join(",") ?? ""}`);
    } finally {
      store.close();
    }
  });

labels
  .command("clear <idOrName>")
  .description("remove all loop labels")
  .action((idOrName) => {
    const store = new Store();
    try {
      const loop = store.requireLoop(idOrName);
      const updated = store.updateLoop(loop.id, { labels: [] });
      print(publicLoop(updated), `${updated.id} labels=`);
    } finally {
      store.close();
    }
  });

function updateStatus(idOrName: string, status: "paused" | "active" | "stopped"): void {
  const store = new Store();
  try {
    const loop = store.requireLoop(idOrName);
    const updated = store.updateLoop(loop.id, { status, nextRunAt: status === "stopped" ? undefined : loop.nextRunAt });
    print(publicLoop(updated), `${updated.id} ${updated.status}`);
  } finally {
    store.close();
  }
}

program
  .command("remove <idOrName>")
  .alias("rm")
  .action((idOrName) => {
    const store = new Store();
    try {
      const removed = store.deleteLoop(idOrName);
      print({ removed }, removed ? "removed" : "not removed");
    } finally {
      store.close();
    }
  });

program
  .command("run-now <idOrName>")
  .option("--show-output", "show stdout/stderr")
  .option("--max-output-chars <n>", `maximum stdout/stderr characters to print; human default ${DEFAULT_HUMAN_OUTPUT_CHARS}`)
  .action(async (idOrName, opts) => {
    const store = new Store();
    try {
      const loop = store.requireLoop(idOrName);
      const runnerId = `manual:${process.pid}`;
      const now = new Date();
      let scheduledFor = manualRunScheduledFor(loop, now);
      let source = manualRunSource(loop, scheduledFor, now);
      let shouldAdvance = shouldAdvanceManualRun(loop, scheduledFor, now);
      let claim = store.claimRun(loop, scheduledFor, runnerId, now);
      if (!claim && shouldAdvance) {
        const existing = store.getRunBySlot(loop.id, scheduledFor);
        if (existing && existing.status !== "running") {
          scheduledFor = now.toISOString();
          source = "ad_hoc";
          shouldAdvance = false;
          claim = store.claimRun(loop, scheduledFor, runnerId, now);
        }
      }
      if (!claim) throw new Error("could not claim manual run");
      const run = await executeClaimedRun({ store, runnerId, loop: claim.loop, run: claim.run });
      if (shouldAdvance) {
        advanceLoop(store, claim.loop, run, new Date(run.finishedAt ?? new Date()), run.status === "succeeded");
      }
      const value = { ...publicRun(run, opts.showOutput, jsonOutputLimit(opts)), runNow: { source, advancesLoop: shouldAdvance } };
      print(value, `${run.id} ${run.status} source=${source} slot=${run.scheduledFor}`);
      if (!isJson() && opts.showOutput) printTextOutput(run, { limit: humanOutputLimit(opts) });
      if (run.status !== "succeeded") process.exitCode = 1;
    } finally {
      store.close();
  }
});

program.command("tick").description("run one scheduler tick").action(async () => {
  const store = new Store();
  try {
    const result = await tick({ store, runnerId: `manual-tick:${process.pid}` });
    print(result, `completed=${result.completed.length} skipped=${result.skipped.length} recovered=${result.recovered.length}`);
  } finally {
    store.close();
  }
});

addVerboseOption(program.command("doctor").description("check local OpenLoops runtime dependencies and state")).action((opts) => {
  const store = new Store();
  try {
    const report = runDoctor(store);
    if (isJson() || isVerbose(opts)) print(report);
    else {
      for (const check of report.checks) {
        const marker = check.status === "ok" ? "ok" : check.status === "warn" ? "warn" : "fail";
        const detail = check.detail ? ` (${truncateDisplay(check.detail, 160)})` : "";
        console.log(`${marker.padEnd(4)} ${check.id.padEnd(22)} ${check.message}${detail}`);
      }
      console.log("Use --verbose or --json for full check details.");
    }
    if (!report.ok) process.exitCode = 1;
  } finally {
    store.close();
  }
});

const daemon = program.command("daemon").description("manage the local daemon");

daemon
  .command("run")
  .option("--interval-ms <ms>", "tick interval", (value) => Number(value))
  .action(async (opts) => runDaemon({ intervalMs: opts.intervalMs }));

daemon.command("start").action(async () => {
  const result = await startDaemon({ cliEntry: process.argv[1] ?? "loops" });
  print(result, result.alreadyRunning ? `already running pid=${result.pid}` : result.started ? `started pid=${result.pid}` : "failed to start");
});

daemon.command("stop").action(async () => {
  const result = await stopDaemon();
  print(result, result.stopped ? `stopped pid=${result.pid}` : "not running");
});

addVerboseOption(daemon.command("status")).action((opts) => {
  const store = new Store();
  try {
    const status = daemonStatus(store);
    printDetail(status, daemonStatusSummary(status), opts);
  } finally {
    store.close();
  }
});

daemon
  .command("install")
  .description("write a systemd user service or launchd plist")
  .option("--enable", "also enable/start the user service when supported")
  .action((opts) => {
    const result = installStartup(process.argv[1] ?? "loops");
    if (opts.enable) result.enableResults = enableStartup(result);
    const enableText = result.enableResults
      ? `\n${result.enableResults.map((item) => `${item.command} -> ${item.status === 0 ? "ok" : `exit ${item.status}`}`).join("\n")}`
      : "";
    print(result, `wrote ${result.path}\n${result.instructions.join("\n")}${enableText}`);
  });

daemon
  .command("logs")
  .option("-n, --lines <n>", "lines", String(DEFAULT_HUMAN_LOG_LINES))
  .option("--max-line-chars <n>", "maximum characters per line", "240")
  .option("-v, --verbose", "print full log lines")
  .action((opts) => {
    const path = daemonLogPath();
    if (!existsSync(path)) {
      console.log("");
      return;
    }
    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    const selected = lines.slice(-positiveInteger(opts.lines, "--lines")!);
    const maxLineChars = isVerbose(opts) ? Number.POSITIVE_INFINITY : positiveInteger(opts.maxLineChars, "--max-line-chars")!;
    console.log(selected.map((line) => truncateDisplay(line, maxLineChars) ?? "").join("\n"));
    if (!isVerbose(opts)) console.log("Use --verbose or --max-line-chars for more log text.");
  });

await program.parseAsync(process.argv);
