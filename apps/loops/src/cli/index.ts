#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Command } from "commander";
import type {
  AccountRef,
  AgentAllowlistSpec,
  AgentProvider,
  CatchUpPolicy,
  CreateLoopInput,
  CreateWorkflowInput,
  Loop,
  LoopStatus,
  LoopTemplateSummary,
  LoopTarget,
  OverlapPolicy,
  ScheduleSpec,
  WorkflowSpec,
} from "../types.js";
import { dataDir, daemonLogPath, dbPath } from "../lib/paths.js";
import {
  publicLoop,
  publicExecutorResult,
  publicGoal,
  publicGoalRun,
  publicRun,
  publicWorkflow,
  publicWorkflowEvent,
  publicWorkflowInvocation,
  publicWorkflowRun,
  publicWorkflowStepRun,
  publicWorkflowWorkItem,
  redact,
  textOutputBlocks,
} from "../lib/format.js";
import { computeNextAfter, parseDuration } from "../lib/recurrence.js";
import { Store } from "../lib/store.js";
import { executeWorkflow, preflightWorkflow } from "../lib/workflow-runner.js";
import { advanceLoop, executeClaimedRun, manualRunScheduledFor, manualRunSource, shouldAdvanceManualRun, tick } from "../lib/scheduler.js";
import { daemonStatus, stopDaemon } from "../daemon/control.js";
import { runDaemon, startDaemon } from "../daemon/daemon.js";
import { enableStartup, installStartup } from "../daemon/install.js";
import { normalizeGoalSpec } from "../lib/workflow-spec.js";
import { runDoctor } from "../lib/doctor.js";
import { buildHealthReport, buildHealthScan, expectationForLoop, writeHealthScanReports } from "../lib/health.js";
import { runLoopsUiApp } from "./ui.js";
import {
  applyImportMigrationBundle,
  buildImportMigrationPlan,
  buildSelfHostedMigrationPlan,
  exportLoopsMigrationBundle,
  publicMigrationBundle,
  registerSelfHostedRunner,
  validateLoopsMigrationBundle,
  type LoopsMigrationPlan,
} from "../lib/migration.js";
import { buildDeploymentStatus, deploymentStatusLine, type LoopDeploymentMode, type LoopDeploymentStatus } from "../lib/mode.js";
import {
  buildDuplicateOverlapReport,
  buildNameHygieneReport,
  buildScriptInventoryReport,
} from "../lib/hygiene.js";
import { listOpenMachines, resolveLoopMachine } from "../lib/machines.js";
import { packageVersion } from "../lib/version.js";
import {
  getLoopTemplate,
  importCustomLoopTemplate,
  listLoopTemplates,
  loopTemplatesDir,
  renderLoopTemplate,
  validateCustomLoopTemplateFile,
  validateLoopTemplateRegistry,
} from "../lib/templates.js";
import { backupDatabase } from "../lib/backup.js";
import { CodedError, ValidationError } from "../lib/errors.js";
import {
  addAgentRoutingOptions,
  addRouteEventOptions,
  addTodosDrainOptions,
  buildHygieneRouteTasks,
  collectValues,
  defaultLoopsProject,
  drainTodosTaskRoutes,
  GateError,
  idleTimeoutDuration,
  listFromRepeatedOpts,
  nonNegativeInteger,
  normalizeLoopTargetForStorage,
  parseHygieneChecks,
  permissionModeFromOpts,
  positiveDuration,
  positiveInteger,
  preflightLoopTarget,
  preflightStoredWorkflow,
  providerAuthProfileFromOpts,
  readEventEnvelopeInput,
  routeCursorKey,
  routeDrainArgs,
  routeEventByKind,
  sandboxFromOpts,
  splitList,
  stringField,
  todosTaskRouteTemplateId,
  timeoutDuration,
  upsertRouteTasks,
  workflowBodyFromFile,
  workflowSpecForPreflight,
  type TodosDrainOptions,
  type TodosTaskRouteOptions,
} from "../lib/route/index.js";

const program = new Command();

program.name("loops").description("Persistent local loops for commands and headless coding agents").version(packageVersion());
program.option("-j, --json", "print JSON");

function isJson(): boolean {
  return Boolean(program.opts().json);
}

function print(value: unknown, human?: string): void {
  if (isJson() || !human) console.log(JSON.stringify(value, null, 2));
  else console.log(human);
}

const LOOP_STATUS_VALUES: LoopStatus[] = ["active", "paused", "stopped", "expired"];

function parseLoopStatuses(value: string | undefined, label = "--include"): LoopStatus[] {
  const raw = splitList(value) ?? ["active", "paused"];
  const expanded = raw.flatMap((entry) => entry === "all" ? LOOP_STATUS_VALUES : [entry]);
  const invalid = expanded.filter((entry) => !LOOP_STATUS_VALUES.includes(entry as LoopStatus));
  if (invalid.length > 0) throw new ValidationError(`${label} has invalid loop status: ${invalid.join(", ")}`);
  return [...new Set(expanded as LoopStatus[])];
}

function compactHealthScanOutput(scan: unknown): unknown {
  if (!scan || typeof scan !== "object" || !("health" in scan)) return scan;
  const healthValue = (scan as { health?: unknown }).health;
  if (!healthValue || typeof healthValue !== "object") return scan;
  const { expectations: _expectations, ...health } = healthValue as Record<string, unknown>;
  return { ...(scan as Record<string, unknown>), health };
}

/**
 * Uniform error reporting for every command action: gate failures keep their
 * stable structured JSON shape, everything else becomes
 * `{ok:false, error:{code, message}}` in JSON mode. No stack traces.
 */
function reportCliError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
  if (error instanceof GateError) {
    if (isJson()) {
      print({
        ok: false,
        created: false,
        [error.gate]: {
          ok: false,
          error: redact(message, 320),
        },
        ...error.context,
      });
      return;
    }
    console.error(`error: ${message}`);
    return;
  }
  if (isJson()) {
    print({ ok: false, error: { code: error instanceof CodedError ? error.code : "ERROR", message: redact(message, 640) } });
  }
  console.error(`error: ${message}`);
}

function runAction<Args extends unknown[]>(fn: (...args: Args) => void | Promise<void>): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    try {
      await fn(...args);
    } catch (error) {
      reportCliError(error);
    }
  };
}

function printDeploymentStatus(status: LoopDeploymentStatus, opts: { json?: boolean } = {}): void {
  if (isJson() || opts.json) console.log(JSON.stringify(status, null, 2));
  else {
    console.log(deploymentStatusLine(status));
    for (const warning of status.warnings) console.log(`warn ${warning}`);
  }
}

function deploymentStatusCommand(mode?: LoopDeploymentMode) {
  return (opts: { json?: boolean } = {}) => {
    printDeploymentStatus(buildDeploymentStatus({ perspective: mode }), opts);
  };
}

function printCreatedLoop(loop: ReturnType<Store["createLoop"]>, human: string, preflight?: unknown): void {
  if (preflight !== undefined) print({ loop: publicLoop(loop), preflight }, human);
  else print(publicLoop(loop), human);
}

function publicWorkflowBody(body: CreateWorkflowInput): Record<string, unknown> {
  const value = publicWorkflow(workflowSpecForPreflight(body, "render"));
  const { id: _id, status: _status, createdAt: _createdAt, updatedAt: _updatedAt, ...bodyOnly } = value;
  return bodyOnly;
}

function workflowWithAgentTimeouts(
  workflow: WorkflowSpec,
  timeoutMs: number | null,
  opts: { name?: string } = {},
): { body: CreateWorkflowInput; changed: boolean; agentStepIds: string[] } {
  let changed = false;
  const agentStepIds: string[] = [];
  const steps = workflow.steps.map((step) => {
    if (step.target.type !== "agent") return step;
    agentStepIds.push(step.id);
    const target = { ...step.target, timeoutMs };
    if (timeoutMs === null && target.idleTimeoutMs !== undefined) {
      delete target.idleTimeoutMs;
      changed = true;
    }
    if (step.timeoutMs !== timeoutMs || step.target.timeoutMs !== timeoutMs) changed = true;
    return {
      ...step,
      target,
      timeoutMs,
    };
  });
  return {
    body: {
      name: opts.name ?? workflow.name,
      description: workflow.description,
      version: workflow.version,
      goal: workflow.goal,
      steps,
    },
    changed,
    agentStepIds,
  };
}

function agentLoopTargetWithTimeout(loop: Loop, timeoutMs: number | null): { changed: boolean; target: Extract<LoopTarget, { type: "agent" }> } {
  if (loop.target.type !== "agent") throw new Error(`loop is not an agent loop: ${loop.name || loop.id}`);
  const target = { ...loop.target, timeoutMs };
  if (timeoutMs === null && target.idleTimeoutMs !== undefined) delete target.idleTimeoutMs;
  const changed = loop.target.timeoutMs !== timeoutMs || (timeoutMs === null && loop.target.idleTimeoutMs !== undefined);
  return { changed, target };
}

function workflowTimeoutMigrationName(workflow: WorkflowSpec, timeoutMs: number | null): string {
  const policy = timeoutMs === null ? "agent-timeout-unlimited" : `agent-timeout-${timeoutMs}ms`;
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  return `${workflow.name}-${policy}-${suffix}`;
}

function workflowGoalWrapperMigrationName(workflow: WorkflowSpec): string {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  return `${workflow.name}-no-workflow-goal-${suffix}`;
}

function publicMigrationGoalSummary(goal: WorkflowSpec["goal"]): Record<string, unknown> | undefined {
  if (!goal) return undefined;
  return {
    objective: redact(goal.objective),
    model: goal.model,
    tokenBudget: goal.tokenBudget,
    maxTurns: goal.maxTurns,
  };
}

function publicMigrationWorkflowSummary(workflow: WorkflowSpec): Record<string, unknown> {
  return {
    id: workflow.id,
    name: workflow.name,
    version: workflow.version,
    status: workflow.status,
    stepCount: workflow.steps.length,
    hasGoal: Boolean(workflow.goal),
    goal: publicMigrationGoalSummary(workflow.goal),
  };
}

function publicMigrationLoopSummary(loop: Loop): Record<string, unknown> {
  return {
    id: loop.id,
    name: loop.name,
    status: loop.status,
    archivedAt: loop.archivedAt,
    nextRunAt: loop.nextRunAt,
    hasGoal: Boolean(loop.goal),
    goal: publicMigrationGoalSummary(loop.goal),
    target:
      loop.target.type === "workflow"
        ? { type: "workflow", workflowId: loop.target.workflowId, timeoutMs: loop.target.timeoutMs }
        : { type: loop.target.type },
  };
}

function migrationErrorReason(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  return redact(message, 240);
}

function printTextOutput(value: { stdout?: string; stderr?: string }): void {
  for (const line of textOutputBlocks(value, { indent: "  " })) console.log(line);
}

function parseSchedule(opts: { at?: string; every?: string; cron?: string; dynamic?: boolean }): ScheduleSpec {
  const count = [opts.at, opts.every, opts.cron, opts.dynamic ? "dynamic" : undefined].filter(Boolean).length;
  if (count !== 1) throw new ValidationError("choose exactly one schedule: --at, --every, --cron, or --dynamic");
  if (opts.at) return { type: "once", at: new Date(opts.at).toISOString() };
  if (opts.every) return { type: "interval", everyMs: parseDuration(opts.every), anchor: "fixed_rate" };
  if (opts.cron) return { type: "cron", expression: opts.cron };
  return { type: "dynamic", minIntervalMs: 60_000 };
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
  if (!["none", "latest", "all"].includes(catchUp)) throw new ValidationError("--catch-up must be none, latest, or all");
  const overlap = (opts.overlap ?? "skip") as OverlapPolicy;
  if (!["skip", "allow"].includes(overlap)) throw new ValidationError("--overlap must be skip or allow");
  return {
    catchUp,
    catchUpLimit: positiveInteger(opts.catchUpLimit, "--catch-up-limit"),
    overlap,
    maxAttempts: positiveInteger(opts.attempts, "--attempts"),
    retryDelayMs: positiveDuration(opts.retryDelay, "--retry-delay"),
    leaseMs: positiveDuration(opts.lease, "--lease"),
  };
}

function durationLabel(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const units: Array<[number, string]> = [
    [7 * 24 * 60 * 60 * 1000, "w"],
    [24 * 60 * 60 * 1000, "d"],
    [60 * 60 * 1000, "h"],
    [60 * 1000, "m"],
    [1_000, "s"],
  ];
  for (const [unitMs, label] of units) {
    if (ms % unitMs === 0) return `${ms / unitMs}${label}`;
  }
  return `${ms}ms`;
}

function scheduleLabel(schedule: ScheduleSpec): string {
  if (schedule.type === "once") return `once:${schedule.at}`;
  if (schedule.type === "interval") return `every:${durationLabel(schedule.everyMs) || `${schedule.everyMs}ms`}`;
  if (schedule.type === "cron") return `cron:${schedule.expression}`;
  return schedule.minIntervalMs ? `dynamic:min-${durationLabel(schedule.minIntervalMs) || `${schedule.minIntervalMs}ms`}` : "dynamic";
}

function targetLabel(target: LoopTarget): string {
  if (target.type === "command") return `runs command ${target.command}`;
  if (target.type === "agent") return `runs ${target.provider} agent${target.cwd ? ` in ${target.cwd}` : ""}`;
  return `runs workflow ${target.workflowId}`;
}

function defaultLoopDescription(name: string, schedule: ScheduleSpec, target: LoopTarget): string {
  return [
    `Why: keep ${name} running as an OpenLoops scheduled automation.`,
    `How: ${targetLabel(target)} on cadence ${scheduleLabel(schedule)}.`,
    "Outcome: record each run, status, retries, and evidence in OpenLoops for operator review.",
  ].join(" ");
}

function baseCreateInput(name: string, opts: Record<string, string | boolean | undefined>, target: LoopTarget): CreateLoopInput {
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
  const explicitDescription = typeof opts.description === "string" && opts.description.trim() ? opts.description : undefined;
  return {
    name,
    description: explicitDescription ?? defaultLoopDescription(name, schedule, target),
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

function goalFromOpts(opts: Record<string, string | boolean | undefined>) {
  const hasGoalOption = opts.goal !== undefined || opts.goalBudget !== undefined || opts.goalModel !== undefined || opts.goalMaxTurns !== undefined;
  if (!hasGoalOption) return undefined;
  if (typeof opts.goal !== "string") throw new ValidationError("--goal is required when using goal options");
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

function accountFromOpts(opts: {
  account?: string;
  accountTool?: string;
  accountPool?: string;
  triageAccount?: string;
  plannerAccount?: string;
  workerAccount?: string;
  verifierAccount?: string;
}): AccountRef | undefined {
  if (!opts.account && opts.accountTool && !opts.accountPool && !opts.triageAccount && !opts.plannerAccount && !opts.workerAccount && !opts.verifierAccount) {
    throw new ValidationError("--account-tool requires --account, --account-pool, --triage-account, --planner-account, --worker-account, or --verifier-account");
  }
  return opts.account ? { profile: opts.account, tool: opts.accountTool } : undefined;
}

function allowlistFromOpts(opts: { allowTool?: string[]; allowCommand?: string[] }): AgentAllowlistSpec | undefined {
  const tools = (opts.allowTool ?? []).flatMap((entry) => splitList(entry) ?? []);
  const commands = (opts.allowCommand ?? []).flatMap((entry) => splitList(entry) ?? []);
  if (!tools.length && !commands.length) return undefined;
  return {
    tools: tools.length ? tools : undefined,
    commands: commands.length ? commands : undefined,
    enforcement: "metadata_only",
  };
}

function runtimePreflightFromOpts(opts: { preflightEachRun?: boolean }): { beforeRun: true } | undefined {
  return opts.preflightEachRun ? { beforeRun: true } : undefined;
}

function parseVars(values: string[] | undefined): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const value of values ?? []) {
    const index = value.indexOf("=");
    if (index <= 0) throw new ValidationError(`invalid --var value, expected key=value: ${value}`);
    vars[value.slice(0, index)] = value.slice(index + 1);
  }
  return vars;
}

function parseJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`failed to read JSON file ${file}: ${reason}`);
  }
}

function parseStringMap(values: string[] | undefined, flag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of values ?? []) {
    const index = value.indexOf("=");
    if (index <= 0) throw new ValidationError(`invalid ${flag} value, expected key=value: ${value}`);
    result[value.slice(0, index)] = value.slice(index + 1);
  }
  return result;
}

function parseJsonMap(values: string[] | undefined, flag: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const value of values ?? []) {
    const index = value.indexOf("=");
    if (index <= 0) throw new ValidationError(`invalid ${flag} value, expected key=json-or-string: ${value}`);
    const raw = value.slice(index + 1);
    try {
      result[value.slice(0, index)] = JSON.parse(raw);
    } catch {
      result[value.slice(0, index)] = raw;
    }
  }
  return result;
}

function printMigrationPlan(plan: LoopsMigrationPlan, opts: { json?: boolean } = {}): void {
  if (isJson() || opts.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  console.log(
    `${plan.operation} dryRun=${plan.dryRun} workflows=${plan.summary.workflows} loops=${plan.summary.loops} runs=${plan.summary.runs} ` +
      `insert=${plan.summary.insert} update=${plan.summary.update} skip=${plan.summary.skip} conflict=${plan.summary.conflict} blocked=${plan.summary.blocked}`,
  );
  for (const warning of plan.warnings) console.log(`warn ${warning}`);
  for (const row of plan.rows) {
    if (row.action !== "blocked" && row.action !== "conflict") continue;
    console.log(`${row.action} ${row.resource}:${row.name ?? row.id} ${row.reason ?? ""}`.trim());
  }
}

/** Snapshot the database through lib/backup (VACUUM INTO, 1h per-reason debounce, keep 3). */
function backupLoopsDatabase(reason: string): string | undefined {
  return backupDatabase({ reason, keep: 3 }).path;
}

const create = program.command("create").description("create loops");

addGoalOptions(
  addAccountOptions(
    addMachineOptions(
      addScheduleOptions(
      create
        .command("command <name>")
        .description("create a deterministic shell command loop")
        .requiredOption("--cmd <command>", "command string to execute")
        .option("--cwd <dir>", "working directory")
        .option("--timeout <duration>", "run timeout; use none/unlimited for no timeout")
        .option("--no-shell", "execute without a shell")
        .option("--preflight-each-run", "check target executables/accounts before every scheduled run")
        .option("--preflight", "check target executables/accounts before storing the loop"),
      ),
    ),
  ),
).action(runAction((name, opts) => {
  const store = new Store();
  try {
    const target: LoopTarget = {
      type: "command",
      command: opts.cmd,
      cwd: opts.cwd,
      shell: opts.shell,
      timeoutMs: timeoutDuration(opts.timeout, "--timeout"),
      account: accountFromOpts(opts),
      preflight: runtimePreflightFromOpts(opts),
    };
    const input = baseCreateInput(name, opts, target);
    const preflight = opts.preflight
      ? preflightLoopTarget(input.target as Exclude<LoopTarget, { type: "workflow" }>, { name, type: "command" }, { loopName: name }, { machine: input.machine })
      : undefined;
    const loop = store.createLoop(input);
    printCreatedLoop(loop, `created loop ${loop.id} (${loop.name}) next=${loop.nextRunAt}`, preflight);
  } finally {
    store.close();
  }
}));

addGoalOptions(
  addAccountOptions(
    addMachineOptions(
      addScheduleOptions(
      create
        .command("agent <name>")
        .description("create a headless coding-agent loop")
        .requiredOption("--provider <provider>", "claude, cursor, codewith, aicopilot, opencode, or codex")
        .option("--prompt <prompt>", "agent prompt")
        .option("--prompt-file <file>", "read the agent prompt from a markdown/text file")
        .option("--cwd <dir>", "working directory")
        .option("--model <model>", "model")
        .option("--variant <variant>", "provider-specific model variant or reasoning effort")
        .option("--agent <agent>", "provider-specific agent")
        .option("--auth-profile <profile>", "provider-native auth profile; currently supported for codewith")
        .option("--add-dir <dir>", "additional writable directory for provider sandboxes; may be repeated or comma-separated", collectValues, [] as string[])
        .option("--timeout <duration>", "run timeout; use none/unlimited for no timeout")
        .option("--permission-mode <mode>", "provider permission mode: default, plan, auto, or bypass")
        .option("--sandbox <mode>", "provider sandbox: codewith/codex use read-only/workspace-write/danger-full-access; cursor uses enabled/disabled")
        .option("--allow-tool <name>", "advisory per-session tool allowlist metadata; may be repeated or comma-separated", collectValues, [] as string[])
        .option("--allow-command <name>", "advisory per-session command allowlist metadata; may be repeated or comma-separated", collectValues, [] as string[])
        .option("--config-isolation <mode>", "safe or none", "safe")
        .option("--preflight-each-run", "check provider/account readiness before every scheduled run")
        .option("--preflight", "check target executables/accounts before storing the loop"),
      ),
    ),
  ),
).action(runAction((name, opts) => {
  const provider = opts.provider as AgentProvider;
  if (!["claude", "cursor", "codewith", "aicopilot", "opencode", "codex"].includes(provider)) {
    throw new ValidationError("unsupported provider");
  }
  if (!["safe", "none"].includes(opts.configIsolation)) {
    throw new ValidationError("--config-isolation must be safe or none");
  }
  const store = new Store();
  try {
    const target = normalizeLoopTargetForStorage({
      type: "agent",
      provider,
      prompt: opts.prompt,
      promptFile: opts.promptFile,
      cwd: opts.cwd,
      model: opts.model,
      variant: opts.variant,
      agent: opts.agent,
      authProfile: providerAuthProfileFromOpts(opts, provider),
      addDirs: listFromRepeatedOpts(opts.addDir),
      timeoutMs: timeoutDuration(opts.timeout, "--timeout"),
      configIsolation: opts.configIsolation,
      permissionMode: permissionModeFromOpts(opts, provider),
      sandbox: sandboxFromOpts(opts, provider),
      allowlist: allowlistFromOpts(opts),
      account: accountFromOpts(opts),
      preflight: runtimePreflightFromOpts(opts),
    }, { name, type: "agent", provider }, { baseDir: process.cwd() });
    const input = baseCreateInput(name, opts, target);
    const preflight = opts.preflight
      ? preflightLoopTarget(input.target as Exclude<LoopTarget, { type: "workflow" }>, { name, type: "agent", provider }, { loopName: name }, { machine: input.machine })
      : undefined;
    const loop = store.createLoop(input);
    printCreatedLoop(loop, `created loop ${loop.id} (${loop.name}) next=${loop.nextRunAt}`, preflight);
  } finally {
    store.close();
  }
}));

addGoalOptions(
  addMachineOptions(
    addScheduleOptions(
    create
      .command("workflow <name>")
      .description("schedule a stored workflow")
      .requiredOption("--workflow <idOrName>", "workflow id or name")
      .option("--timeout <duration>", "workflow run timeout; use none/unlimited for no workflow-level timeout")
      .option("--preflight-each-run", "check workflow steps before every scheduled run")
      .option("--preflight", "check workflow step executables/accounts before storing the loop"),
    ),
  ),
).action(runAction((name, opts) => {
  const store = new Store();
  try {
    const workflow = store.requireWorkflow(opts.workflow);
    const target: LoopTarget = {
      type: "workflow",
      workflowId: workflow.id,
      timeoutMs: timeoutDuration(opts.timeout, "--timeout"),
      preflight: runtimePreflightFromOpts(opts),
    };
    const input = baseCreateInput(name, opts, target);
    const preflight = opts.preflight
      ? preflightStoredWorkflow(workflow, { name, type: "workflow", workflow: workflow.name }, { machine: input.machine })
      : undefined;
    const loop = store.createLoop(input);
    printCreatedLoop(loop, `created workflow loop ${loop.id} (${loop.name}) workflow=${workflow.name} next=${loop.nextRunAt}`, preflight);
  } finally {
    store.close();
  }
}));

const workflows = program.command("workflows").alias("workflow").description("manage workflow specs and runs");

const templates = program.command("templates").alias("template").description("render and store reusable loop/workflow templates");

const routes = program.command("routes").alias("route").description("create, inspect, and drain workflow invocation/admission routes");

const events = program.command("events").description("(deprecated) Hasna event envelope aliases for 'routes create' and 'routes drain'");

const machines = program.command("machines").description("inspect OpenMachines topology for loop assignment");

const goal = program.command("goal").description("inspect goal runs");

program
  .command("mode")
  .description("show the active OpenLoops deployment mode")
  .option("--json", "print JSON")
  .action(runAction(deploymentStatusCommand()));

const selfHosted = program.command("self-hosted").alias("selfhosted").description("inspect the self-hosted OpenLoops contract");
selfHosted
  .command("status")
  .option("--json", "print JSON")
  .action(runAction(deploymentStatusCommand("self_hosted")));

program
  .command("export")
  .description("export a local OpenLoops migration bundle")
  .requiredOption("--file <path>", "write bundle JSON to this path")
  .option("--dry-run", "preview the bundle without writing the file")
  .option("--no-runs", "omit loop run history from the bundle")
  .option("--allow-redacted", "write a redacted non-importable bundle when env/secrets must be removed")
  .option("--json", "print JSON")
  .action(runAction((opts) => {
    const store = new Store();
    try {
      const bundle = exportLoopsMigrationBundle(store, { includeRuns: opts.runs });
      if (!opts.dryRun && !bundle.importable && !opts.allowRedacted) {
        throw new ValidationError("export is not no-loss because redactions/blockers are present; rerun with --allow-redacted to write a redacted bundle");
      }
      if (!opts.dryRun) writeFileSync(opts.file, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
      const output = {
        ok: true,
        dryRun: Boolean(opts.dryRun),
        file: opts.file,
        bundle: publicMigrationBundle(bundle),
      };
      if (isJson() || opts.json) console.log(JSON.stringify(output, null, 2));
      else {
        console.log(`${opts.dryRun ? "would export" : "exported"} ${opts.file} workflows=${bundle.counts.workflows} loops=${bundle.counts.loops} runs=${bundle.counts.runs}`);
        for (const warning of bundle.warnings) console.log(`warn ${warning}`);
      }
    } finally {
      store.close();
    }
  }));

program
  .command("import <file>")
  .description("preview or apply a local OpenLoops migration bundle")
  .option("--apply", "apply the import; default is a dry-run preview")
  .option("--replace", "update existing rows whose ids match but hashes differ")
  .option("--no-runs", "ignore loop run history in the bundle")
  .option("--json", "print JSON")
  .action(runAction((file, opts) => {
    const bundle = validateLoopsMigrationBundle(parseJsonFile(file));
    const store = new Store();
    try {
      if (!opts.apply) {
        printMigrationPlan(buildImportMigrationPlan(store, bundle, {
          includeRuns: opts.runs,
          replace: opts.replace,
          dryRun: true,
        }), opts);
        return;
      }
      const plan = buildImportMigrationPlan(store, bundle, {
        includeRuns: opts.runs,
        replace: opts.replace,
        dryRun: false,
      });
      if (plan.summary.blocked > 0 || plan.summary.conflict > 0 || !plan.importable) {
        printMigrationPlan(plan, opts);
        throw new ValidationError(`refusing to import unsafe bundle: blocked=${plan.summary.blocked} conflict=${plan.summary.conflict}`);
      }
      const backupPath = backupLoopsDatabase("migration-import");
      const result = applyImportMigrationBundle(store, bundle, {
        includeRuns: opts.runs,
        replace: opts.replace,
        dryRun: false,
      });
      const output = { ok: true, backupPath, ...result };
      if (isJson() || opts.json) console.log(JSON.stringify(output, null, 2));
      else {
        console.log(`imported workflows=${result.applied.workflows} loops=${result.applied.loops} runs=${result.applied.runs}${backupPath ? ` backup=${backupPath}` : ""}`);
      }
    } finally {
      store.close();
    }
  }));

function selfHostedMigrationCommand(operation: "self-hosted-push" | "self-hosted-pull" | "self-hosted-migrate") {
  return runAction(async (opts: { apiUrl?: string; runs?: boolean; json?: boolean }) => {
    const store = new Store();
    try {
      const plan = await buildSelfHostedMigrationPlan(store, {
        operation,
        apiUrl: opts.apiUrl,
        includeRuns: opts.runs,
      });
      printMigrationPlan(plan, opts);
    } finally {
      store.close();
    }
  });
}

selfHosted
  .command("migrate")
  .description("preview local-to-self-hosted migration actions")
  .option("--api-url <url>", "self-hosted control-plane API URL")
  .option("--dry-run", "preview only; self-hosted migrate does not apply remote changes yet")
  .option("--no-runs", "omit loop run history from the preview")
  .option("--json", "print JSON")
  .action(selfHostedMigrationCommand("self-hosted-migrate"));

selfHosted
  .command("push")
  .description("preview local rows that would be pushed to self-hosted")
  .option("--api-url <url>", "self-hosted control-plane API URL")
  .option("--dry-run", "preview only; self-hosted push does not apply remote changes yet")
  .option("--no-runs", "omit loop run history from the preview")
  .option("--json", "print JSON")
  .action(selfHostedMigrationCommand("self-hosted-push"));

selfHosted
  .command("pull")
  .description("preview self-hosted rows that would be pulled locally")
  .option("--api-url <url>", "self-hosted control-plane API URL")
  .option("--dry-run", "preview only; self-hosted pull does not apply local changes yet")
  .option("--no-runs", "omit loop run history from the preview")
  .option("--json", "print JSON")
  .action(selfHostedMigrationCommand("self-hosted-pull"));

selfHosted
  .command("runner-register")
  .description("register this machine as a self-hosted runner")
  .requiredOption("--runner-id <id>", "stable runner id")
  .option("--api-url <url>", "self-hosted control-plane API URL")
  .option("--machine-id <id>", "OpenMachines machine id")
  .option("--label <key=value>", "runner label; may be repeated or comma-separated", collectValues, [] as string[])
  .option("--capability <key=json>", "runner capability; may be repeated or comma-separated", collectValues, [] as string[])
  .option("--dry-run", "preview registration without posting")
  .option("--apply", "post the registration to the control plane")
  .option("--json", "print JSON")
  .action(runAction(async (opts) => {
    if (opts.apply && opts.dryRun) throw new ValidationError("use either --apply or --dry-run, not both");
    const request = {
      apiUrl: opts.apiUrl,
      runnerId: opts.runnerId,
      machineId: opts.machineId,
      labels: parseStringMap(listFromRepeatedOpts(opts.label), "--label"),
      capabilities: parseJsonMap(listFromRepeatedOpts(opts.capability), "--capability"),
    };
    const result = opts.apply
      ? await registerSelfHostedRunner(request)
      : { ok: true, dryRun: true, runner: request };
    if (isJson() || opts.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${opts.apply ? "registered" : "would register"} runner ${String(opts.runnerId)}`);
  }));

const cloud = program.command("cloud").description("inspect the hosted OpenLoops contract");
cloud
  .command("status")
  .option("--json", "print JSON")
  .action(runAction(deploymentStatusCommand("cloud")));

function formatTemplateVariable(template: LoopTemplateSummary, name: string): string {
  const variable = template.variables.find((entry) => entry.name === name);
  const placeholder = variable?.default ? variable.default : `<${name}>`;
  return `  --var ${name}=${placeholder}`;
}

function templateSource(value: string | undefined): "all" | "builtin" | "custom" {
  const source = value ?? "all";
  if (source === "all" || source === "builtin" || source === "custom") return source;
  throw new ValidationError("--source must be all, builtin, or custom");
}

function addTemplateSourceOption(command: Command, defaultValue = "all"): Command {
  return command.option("--source <source>", "template source: all, builtin, or custom", defaultValue);
}

function printTemplateDetails(template: LoopTemplateSummary): void {
  console.log(`${template.id} (${template.kind})`);
  console.log(template.name);
  if (template.source) console.log(`source: ${template.source}${template.sourcePath ? ` (${template.sourcePath})` : ""}`);
  console.log("");
  console.log(template.description);
  console.log("");
  console.log("Variables:");
  const nameWidth = Math.max(...template.variables.map((variable) => variable.name.length), 4);
  for (const variable of template.variables) {
    const required = variable.required ? "required" : "optional";
    const defaultValue = variable.default ? ` default=${variable.default}` : "";
    const description = variable.description ? `  ${variable.description}` : "";
    console.log(`  ${variable.name.padEnd(nameWidth)}  ${required}${defaultValue}${description}`);
  }
  const requiredVariables = template.variables.filter((variable) => variable.required).map((variable) => variable.name);
  const hintVariables = requiredVariables.length ? requiredVariables : template.variables.slice(0, 2).map((variable) => variable.name);
  const renderArgs = hintVariables.map((name) => formatTemplateVariable(template, name));
  const renderHint = renderArgs.length ? ` \\\n${renderArgs.join(" \\\n")}` : "";
  console.log("");
  console.log("Usage:");
  console.log(`  loops templates render ${template.id}${renderHint}`);
  if (template.kind === "workflow") console.log(`  loops workflows create --template ${template.id}${renderHint}`);
}

function workflowStatusFromOpts(status: string | undefined, all: boolean | undefined): WorkflowSpec["status"] | undefined {
  if (all) {
    if (status && status !== "active") throw new ValidationError("use either --all or --status, not both");
    return undefined;
  }
  const value = status ?? "active";
  if (value === "all") return undefined;
  if (value === "active" || value === "archived") return value;
  throw new ValidationError("--status must be active, archived, or all");
}

function printWorkflowListWarning(args: { shown: number; total: number; status?: WorkflowSpec["status"]; offset: number; limit?: number }): void {
  if (args.shown + args.offset >= args.total && args.offset === 0) return;
  const scope = args.status ?? "all";
  const nextOffset = args.offset + args.shown;
  const next = args.limit && nextOffset < args.total ? ` next page: --limit ${args.limit} --offset ${nextOffset}` : "";
  console.error(`showing ${args.offset + args.shown} of ${args.total} ${scope} workflows.${next}`);
}

templates
  .command("list")
  .alias("ls")
  .description("list OpenLoops templates")
  .option("--source <source>", "template source: all, builtin, or custom", "all")
  .action(runAction((opts) => {
    const values = listLoopTemplates({ source: templateSource(opts.source) });
    if (isJson()) print(values);
    else {
      for (const template of values) {
        console.log(`${template.id}\t${template.source ?? "builtin"}\t${template.kind}\t${template.description}`);
      }
    }
  }));

templates
  .command("import <file>")
  .alias("add")
  .description("import a custom workflow template JSON file into the local registry")
  .option("--replace", "replace an existing custom template with the same id")
  .action(runAction((file, opts) => {
    const result = importCustomLoopTemplate(file, { replace: Boolean(opts.replace) });
    print(result, `${result.replaced ? "replaced" : "imported"} custom template ${result.template.id} -> ${result.path}`);
  }));

templates
  .command("validate [file]")
  .description("validate a custom template JSON file or the local template registry")
  .option("--source <source>", "template source to validate when no file is given: all, builtin, or custom", "all")
  .action(runAction((file, opts) => {
    if (file) {
      const template = validateCustomLoopTemplateFile(file);
      print({ ok: true, template, customDir: loopTemplatesDir() }, `valid custom template ${template.id}`);
      return;
    }
    const result = validateLoopTemplateRegistry({ source: templateSource(opts.source) });
    print(result, `valid template registry (${result.templates.length} templates) customDir=${result.customDir}`);
  }));

addTemplateSourceOption(templates.command("show <id>").description("show a template")).action(runAction((id, opts) => {
  const template = getLoopTemplate(id, { source: templateSource(opts.source) });
  if (!template) throw new Error(`template not found: ${id}`);
  if (isJson()) print(template);
  else printTemplateDetails(template);
}));

addTemplateSourceOption(
  templates
    .command("render <id>")
    .description("render a template as workflow JSON")
    .option("--var <key=value>", "template variable; may be repeated", collectValues, [] as string[]),
)
  .action(runAction((id, opts) => {
    const workflow = renderLoopTemplate(id, parseVars(opts.var), { source: templateSource(opts.source) });
    const value = publicWorkflowBody(workflow);
    print(value, JSON.stringify(value, null, 2));
  }));

function createWorkflowFromTemplate(id: string, opts: { var?: string[]; source?: string; name?: string; preflight?: boolean }): void {
  const store = new Store();
  try {
    let body = renderLoopTemplate(id, parseVars(opts.var), { source: templateSource(opts.source) });
    if (opts.name) body = { ...body, name: opts.name };
    const preflight = opts.preflight
      ? preflightStoredWorkflow(workflowSpecForPreflight(body, "creation-preflight"), { name: body.name, type: "workflow", template: id }, {})
      : undefined;
    const workflow = store.createWorkflow(body);
    if (preflight !== undefined) print({ workflow: publicWorkflow(workflow), preflight }, `created workflow ${workflow.id} (${workflow.name}) steps=${workflow.steps.length}`);
    else print(publicWorkflow(workflow), `created workflow ${workflow.id} (${workflow.name}) steps=${workflow.steps.length}`);
  } finally {
    store.close();
  }
}

addTemplateSourceOption(
  templates
    .command("create-workflow <id>")
    .description("(deprecated: use 'workflows create --template <id>') render and store a template as a workflow")
    .option("--var <key=value>", "template variable; may be repeated", collectValues, [] as string[]),
)
  .action(runAction((id, opts) => createWorkflowFromTemplate(id, opts)));

routes
  .command("list")
  .description("list admission work items")
  .option("--status <status>", "filter by work item status")
  .option("--route-key <key>", "filter by route key")
  .option("--limit <n>", "maximum rows", "50")
  .action(runAction((opts) => {
    const store = new Store();
    try {
      const items = store.listWorkflowWorkItems({
        status: opts.status,
        routeKey: opts.routeKey,
        limit: positiveInteger(opts.limit, "--limit") ?? 50,
      });
      if (isJson()) print(items.map(publicWorkflowWorkItem));
      else {
        for (const item of items) {
          console.log(`${item.id} ${item.status.padEnd(10)} ${item.routeKey} ${item.subjectRef} ${item.loopId ?? "-"}`);
        }
      }
    } finally {
      store.close();
    }
  }));

routes
  .command("show <id>")
  .description("show one admission work item")
  .action(runAction((id) => {
    const store = new Store();
    try {
      const item = store.getWorkflowWorkItem(id);
      if (!item) throw new Error(`route work item not found: ${id}`);
      const invocation = store.getWorkflowInvocation(item.invocationId);
      const workflow = item.workflowId ? store.getWorkflow(item.workflowId) : undefined;
      const loop = item.loopId ? store.getLoop(item.loopId) : undefined;
      print(
        {
          item: publicWorkflowWorkItem(item),
          invocation: invocation ? publicWorkflowInvocation(invocation) : undefined,
          workflow: workflow ? publicWorkflow(workflow) : undefined,
          loop: loop ? publicLoop(loop) : undefined,
        },
        `${item.id} ${item.status} ${item.routeKey} ${item.subjectRef}`,
      );
    } finally {
      store.close();
    }
  }));

routes
  .command("requeue <id>")
  .description("requeue a terminal admission work item for the next task/event delivery")
  .option("--reason <text>", "operator reason recorded on the work item")
  .action(runAction((id, opts) => {
    const store = new Store();
    try {
      const reason = stringField(opts.reason);
      if (!reason) throw new ValidationError("routes requeue requires --reason <text>");
      const item = store.requeueWorkflowWorkItem(id, { reason });
      print(publicWorkflowWorkItem(item), `requeued route work item ${item.id} (${item.routeKey})`);
    } finally {
      store.close();
    }
  }));

routes
  .command("invocations")
  .description("list workflow invocations")
  .option("--limit <n>", "maximum rows", "50")
  .action(runAction((opts) => {
    const store = new Store();
    try {
      const invocations = store.listWorkflowInvocations({ limit: positiveInteger(opts.limit, "--limit") ?? 50 });
      if (isJson()) print(invocations.map(publicWorkflowInvocation));
      else {
        for (const invocation of invocations) {
          console.log(
            `${invocation.id} ${invocation.intent.padEnd(8)} ${invocation.sourceRef.kind}:${invocation.sourceRef.id ?? "-"} -> ${invocation.subjectRef.kind}:${invocation.subjectRef.id ?? invocation.subjectRef.path ?? "-"}`,
          );
        }
      }
    } finally {
      store.close();
    }
  }));

async function handleRouteEvent(kind: string, opts: TodosTaskRouteOptions): Promise<void> {
  const event = await readEventEnvelopeInput(opts);
  const result = routeEventByKind(kind, event, opts);
  print(result.value, result.human);
}

function handleRouteDrain(kind: string, opts: TodosDrainOptions): void {
  if (kind !== "todos-task") throw new ValidationError("route drain currently supports kind todos-task");
  const result = drainTodosTaskRoutes(opts);
  print(result.value, result.human);
  // Non-skippable route errors are captured per-task so the batch completes, but
  // the run must not report success: a systemic misconfig where every candidate
  // is fatal would otherwise exit 0 and a daemon-scheduled drain loop would mark
  // a route-nothing run "succeeded", hiding the failure from monitoring.
  const fatal = Number(result.value.fatal ?? 0);
  if (fatal > 0) {
    console.error(`route drain hit ${fatal} non-skippable task error(s); see evidence file`);
    process.exitCode = 1;
  }
}

addRouteEventOptions(
  routes
    .command("preview <kind>")
    .description("(deprecated: use 'routes create <kind> --dry-run') preview a route-created workflow invocation without storing it"),
).action(runAction(async (kind, opts) => handleRouteEvent(kind, { ...opts, dryRun: true })));

addRouteEventOptions(
  routes
    .command("create <kind>")
    .description("create a route workflow invocation and admit it when capacity allows"),
  { dryRunDescription: "preview the generated workflow invocation and loop without storing anything" },
).action(runAction(async (kind, opts) => handleRouteEvent(kind, opts)));

addTodosDrainOptions(
  routes
    .command("drain <kind>")
    .description("drain a durable source queue into bounded route workflow loops"),
).action(runAction((kind, opts) => handleRouteDrain(kind, opts)));

addScheduleOptions(
  addTodosDrainOptions(
    routes
      .command("schedule <kind> <name>")
      .description("schedule a deterministic route drain loop"),
    {
      includeDryRun: false,
      preflightDescription: "forward generated workflow preflight checks into each future drain run",
    },
  ),
).action(runAction((kind, name, opts) => {
  if (kind !== "todos-task") throw new ValidationError("route schedule currently supports kind todos-task");
  todosTaskRouteTemplateId(opts);
  const store = new Store();
  try {
    const target: LoopTarget = {
      type: "command",
      command: "loops",
      args: ["--json", ...routeDrainArgs({ ...opts, compact: opts.compact ?? true })],
      timeoutMs: parseDuration("20m"),
      preflight: runtimePreflightFromOpts(opts),
    };
    const input = baseCreateInput(name, opts, target);
    const preflight = opts.preflight
      ? preflightLoopTarget(input.target as Exclude<LoopTarget, { type: "workflow" }>, { name, type: "route-drain", kind }, { loopName: name }, { machine: input.machine })
      : undefined;
    const loop = store.createLoop(input);
    printCreatedLoop(loop, `created route drain loop ${loop.id} (${loop.name}) next=${loop.nextRunAt}`, preflight);
  } finally {
    store.close();
  }
}));

const eventsHandle = events.command("handle").description("(deprecated) handle a Hasna event envelope; alias of 'routes create'");

addRouteEventOptions(
  eventsHandle
    .command("todos-task")
    .description("(deprecated: use 'routes create todos-task') create a one-shot worker/verifier workflow loop for a todos task event"),
  {
    namePrefixDefault: "event:todos-task",
    preflightDescription: "check generated workflow steps before storing the workflow loop",
    dryRunDescription: "print the workflow and loop input without storing anything",
  },
).action(runAction(async (opts) => handleRouteEvent("todos-task", opts)));

addAgentRoutingOptions(
  eventsHandle
    .command("generic")
    .description("(deprecated: use 'routes create generic') create a one-shot worker/verifier workflow loop for any Hasna event"),
  {
    eventInput: true,
    providerDefault: "codewith",
    namePrefixDefault: "event:generic",
    preflightDescription: "check generated workflow steps before storing the workflow loop",
    dryRunDescription: "print the workflow and loop input without storing anything",
  },
).action(runAction(async (opts) => handleRouteEvent("generic", opts)));

const eventsDrain = events.command("drain").description("(deprecated) drain durable source queues; alias of 'routes drain'");

addTodosDrainOptions(
  eventsDrain
    .command("todos-task")
    .description("(deprecated: use 'routes drain todos-task') drain ready todos tasks into bounded worker/verifier workflow loops"),
).action(runAction((opts) => handleRouteDrain("todos-task", opts)));

function showGoal(idOrName: string): void {
  const store = new Store();
  try {
    const runtimeGoal = store.getGoal(idOrName) ?? store.findGoalByLoop(idOrName) ?? store.findGoalByRunId(idOrName);
    if (runtimeGoal) {
      const value = {
        goal: publicGoal(runtimeGoal),
        nodes: store.listGoalPlanNodes(runtimeGoal.goalId),
        runs: store.listGoalRuns({ goalId: runtimeGoal.goalId }).map(publicGoalRun),
      };
      print(value, `${runtimeGoal.goalId} ${runtimeGoal.status} ${runtimeGoal.objective}`);
      return;
    }
    const loop = store.getLoop(idOrName) ?? store.findLoopByName(idOrName);
    if (loop?.goal) {
      print({ config: loop.goal, loop: publicLoop(loop) }, `configured goal for loop ${loop.name}: ${loop.goal.objective}`);
      return;
    }
    const workflow = store.getWorkflow(idOrName) ?? store.findWorkflowByName(idOrName);
    if (workflow?.goal) {
      print({ config: workflow.goal, workflow: publicWorkflow(workflow) }, `configured goal for workflow ${workflow.name}: ${workflow.goal.objective}`);
      return;
    }
    throw new Error(`goal not found: ${idOrName}`);
  } finally {
    store.close();
  }
}

goal
  .command("show <idOrName>")
  .description("show a goal by id, loop, workflow, run id, or configured goal wrapper")
  .action(runAction(showGoal));

goal
  .command("status <runId>")
  .description("(deprecated: merged into 'goal show') show goal status for a goal, goal event, loop run, or workflow run")
  .action(runAction(showGoal));

machines
  .command("list")
  .alias("ls")
  .description("list known machines")
  .action(runAction(() => {
    const values = listOpenMachines();
    if (isJson()) print(values);
    else {
      for (const machine of values) {
        const route = machine.local ? "local" : machine.route ?? "-";
        console.log(`${machine.id.padEnd(12)}  ${route.padEnd(10)}  workspace=${machine.workspacePath ?? "-"}  host=${machine.hostname ?? "-"}`);
      }
    }
  }));

machines.command("show <id>").description("resolve a machine assignment").action(runAction((id) => {
  print(resolveLoopMachine(id));
}));

workflows
  .command("validate <file>")
  .description("validate a workflow JSON file without storing or running it")
  .option("--name <name>", "override workflow name from the file")
  .option("--preflight", "also check account env and target executables")
  .action(runAction((file, opts) => {
    const body = workflowBodyFromFile(file, opts.name, { file, type: "workflow" });
    const workflow = workflowSpecForPreflight(body);
    const preflight = opts.preflight ? preflightWorkflow(workflow) : undefined;
    print({ valid: true, workflow: publicWorkflow(workflow), preflight }, `valid workflow ${workflow.name} steps=${workflow.steps.length}`);
  }));

workflows
  .command("create [file]")
  .description("validate and store a workflow JSON file, or render a template with --template")
  .option("--name <name>", "override workflow name from the file or template")
  .option("--template <id>", "render and store a workflow template instead of reading a file")
  .option("--var <key=value>", "template variable for --template; may be repeated", collectValues, [] as string[])
  .option("--source <source>", "template source for --template: all, builtin, or custom", "all")
  .option("--preflight", "also check account env and target executables before storing")
  .action(runAction((file, opts) => {
    if (opts.template && file) throw new ValidationError("choose either a workflow JSON file or --template <id>, not both");
    if (opts.template) {
      createWorkflowFromTemplate(opts.template, opts);
      return;
    }
    if (!file) throw new ValidationError("workflows create requires a workflow JSON file or --template <id>");
    const store = new Store();
    try {
      const body = workflowBodyFromFile(file, opts.name, { file, type: "workflow" });
      const preflight = opts.preflight
        ? preflightStoredWorkflow(workflowSpecForPreflight(body, "creation-preflight"), { name: body.name, type: "workflow" }, {})
        : undefined;
      const workflow = store.createWorkflow(body);
      if (preflight !== undefined) print({ workflow: publicWorkflow(workflow), preflight }, `created workflow ${workflow.id} (${workflow.name}) steps=${workflow.steps.length}`);
      else print(publicWorkflow(workflow), `created workflow ${workflow.id} (${workflow.name}) steps=${workflow.steps.length}`);
    } finally {
      store.close();
    }
  }));

workflows
  .command("list")
  .alias("ls")
  .description("list stored workflows")
  .option("--status <status>", "active, archived, or all", "active")
  .option("--all", "include active and archived workflows")
  .option("--limit <n>", "maximum rows to print; omitted means all matching workflows")
  .option("--offset <n>", "number of matching rows to skip before printing", "0")
  .action(runAction((opts) => {
    const store = new Store();
    try {
      const status = workflowStatusFromOpts(opts.status, opts.all);
      const limit = positiveInteger(opts.limit, "--limit");
      const offset = nonNegativeInteger(opts.offset, "--offset") ?? 0;
      const workflowsList = store.listWorkflows({ status, limit, offset });
      const total = store.countWorkflows({ status });
      if (isJson()) print(workflowsList.map(publicWorkflow));
      else {
        for (const workflow of workflowsList) {
          console.log(`${workflow.id}  ${workflow.status.padEnd(8)}  steps=${workflow.steps.length}  ${workflow.name}`);
        }
      }
      if (limit !== undefined || offset > 0) printWorkflowListWarning({ shown: workflowsList.length, total, status, offset, limit });
    } finally {
      store.close();
    }
  }));

workflows.command("show <idOrName>").description("show one stored workflow spec").action(runAction((idOrName) => {
  const store = new Store();
  try {
    print(publicWorkflow(store.requireWorkflow(idOrName)));
  } finally {
    store.close();
  }
}));

workflows.command("inspect <runId>").description("show a workflow run with steps and events").action(runAction((runId) => {
  const store = new Store();
  try {
    const run = store.requireWorkflowRun(runId);
    const steps = store.listWorkflowStepRuns(run.id);
    const runEvents = store.listWorkflowEvents(run.id);
    const value = {
      workflowRun: publicWorkflowRun(run),
      steps: steps.map((step) => publicWorkflowStepRun(step)),
      events: runEvents.map(publicWorkflowEvent),
    };
    if (isJson()) print(value);
    else {
      console.log(`${run.id}  ${run.status}  ${run.workflowName}`);
      for (const step of steps) {
        const publicStep = publicWorkflowStepRun(step);
        console.log(`  ${String(step.sequence).padStart(2, "0")}  ${step.status.padEnd(10)}  ${step.stepId}  ${publicStep.error ?? ""}`);
      }
      console.log(`  events=${runEvents.length}`);
    }
  } finally {
    store.close();
  }
}));

workflows
  .command("run <idOrName>")
  .description("execute a stored workflow once now")
  .option("--show-output", "show step stdout/stderr")
  .action(runAction(async (idOrName, opts) => {
    const store = new Store();
    try {
      const workflow = store.requireWorkflow(idOrName);
      const result = await executeWorkflow(store, workflow);
      const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
      const steps = run ? store.listWorkflowStepRuns(run.id) : [];
      const value = {
        result: publicExecutorResult(result),
        workflowRun: run ? publicWorkflowRun(run) : undefined,
        steps: steps.map((step) => publicWorkflowStepRun(step, opts.showOutput)),
      };
      if (isJson()) print(value);
      else {
        console.log(`${run?.id ?? workflow.id} ${result.status}`);
        for (const step of steps) {
          const publicStep = publicWorkflowStepRun(step, opts.showOutput);
          console.log(`  ${String(step.sequence).padStart(2, "0")}  ${step.status.padEnd(10)}  ${step.stepId}  ${publicStep.error ?? ""}`);
          if (opts.showOutput) printTextOutput(step);
        }
      }
      if (result.status !== "succeeded") process.exitCode = 1;
    } finally {
      store.close();
    }
  }));

workflows
  .command("runs [idOrName]")
  .description("list workflow runs, optionally for one workflow")
  .option("--limit <n>", "limit", "50")
  .action(runAction((idOrName, opts) => {
    const store = new Store();
    try {
      const workflow = idOrName ? store.requireWorkflow(idOrName) : undefined;
      const runs = store.listWorkflowRuns({ workflowId: workflow?.id, limit: positiveInteger(opts.limit, "--limit") ?? 50 });
      if (isJson()) print(runs.map(publicWorkflowRun));
      else {
        for (const run of runs) {
          console.log(`${run.id}  ${run.status.padEnd(10)}  ${run.workflowName}  started=${run.startedAt ?? "-"}`);
        }
      }
    } finally {
      store.close();
    }
  }));

workflows
  .command("events <runId>")
  .description("list step/lifecycle events for a workflow run")
  .option("--limit <n>", "limit", "200")
  .action(runAction((runId, opts) => {
    const store = new Store();
    try {
      const runEvents = store.listWorkflowEvents(runId, positiveInteger(opts.limit, "--limit") ?? 200);
      if (isJson()) print(runEvents.map(publicWorkflowEvent));
      else {
        for (const event of runEvents) {
          console.log(`${String(event.sequence).padStart(3, "0")}  ${event.eventType.padEnd(14)}  ${event.stepId ?? "-"}  ${event.createdAt}`);
        }
      }
    } finally {
      store.close();
    }
  }));

workflows
  .command("cancel <runId>")
  .description("mark a workflow run cancelled and cancel pending/running steps")
  .option("--reason <reason>", "cancellation reason", "cancelled by user")
  .action(runAction((runId, opts) => {
    const store = new Store();
    try {
      const run = store.cancelWorkflowRun(runId, opts.reason);
      print(publicWorkflowRun(run), `${run.id} ${run.status}`);
    } finally {
      store.close();
    }
  }));

workflows
  .command("recover <runId>")
  .description("reset interrupted running workflow steps to pending")
  .option("--reason <reason>", "recovery reason", "manual recovery")
  .action(runAction((runId, opts) => {
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
  }));

workflows
  .command("migrate-agent-timeouts")
  .description("migrate workflow loops, or a direct agent loop selected with --loop, to a new agent timeout policy")
  .option("--loop <idOrName>", "migrate only one loop; required for direct agent loops")
  .option("--timeout <duration>", "agent timeout policy; use none/unlimited for no timeout", "none")
  .option("--apply", "create new workflow specs or update direct agent targets for eligible loops")
  .option("--archive-old", "archive old workflow specs after retargeting when no active loops still reference them")
  .action(runAction((opts) => {
    const store = new Store();
    try {
      const timeoutMs = timeoutDuration(opts.timeout, "--timeout") ?? null;
      const candidateLoops = opts.loop
        ? [store.requireUniqueLoop(opts.loop)]
        : store.listLoops({ status: "active", limit: 10_000 }).filter((loop) => loop.target.type === "workflow");
      const rows: Array<Record<string, unknown>> = [];

      for (const loop of candidateLoops) {
        if (loop.archivedAt) {
          rows.push({ loop: publicLoop(loop), status: "skipped", reason: "loop is archived" });
          continue;
        }
        if (loop.target.type === "agent") {
          const migration = agentLoopTargetWithTimeout(loop, timeoutMs);
          if (!migration.changed) {
            rows.push({ loop: publicLoop(loop), status: "skipped", reason: "agent timeout policy already matches" });
            continue;
          }
          if (store.hasRunningRun(loop.id)) {
            rows.push({ loop: publicLoop(loop), status: "blocked", reason: "loop has a running run; retry after it finishes" });
            continue;
          }

          if (!opts.apply) {
            rows.push({
              loop: publicLoop(loop),
              status: "would_update",
              target: { ...migration.target, prompt: redact(migration.target.prompt) },
              timeoutMs,
            });
            continue;
          }

          try {
            const updated = store.updateAgentLoopTimeout(loop.id, timeoutMs);
            rows.push({
              loop: publicLoop(updated),
              previousLoop: publicLoop(loop),
              status: "updated",
              timeoutMs,
            });
          } catch (error) {
            rows.push({
              loop: publicLoop(loop),
              status: "blocked",
              reason: migrationErrorReason(error),
              timeoutMs,
            });
          }
          continue;
        }
        if (loop.target.type !== "workflow") {
          rows.push({ loop: publicLoop(loop), status: "skipped", reason: "loop is not an agent or workflow loop" });
          continue;
        }
        const workflow = store.requireWorkflow(loop.target.workflowId);
        const nextWorkflowName = workflowTimeoutMigrationName(workflow, timeoutMs);
        const migration = workflowWithAgentTimeouts(workflow, timeoutMs, { name: nextWorkflowName });
        if (migration.agentStepIds.length === 0) {
          rows.push({ loop: publicLoop(loop), workflow: publicWorkflow(workflow), status: "skipped", reason: "workflow has no agent steps" });
          continue;
        }
        if (!migration.changed) {
          rows.push({ loop: publicLoop(loop), workflow: publicWorkflow(workflow), status: "skipped", reason: "agent timeout policy already matches" });
          continue;
        }
        if (store.hasRunningRun(loop.id)) {
          rows.push({ loop: publicLoop(loop), workflow: publicWorkflow(workflow), status: "blocked", reason: "loop has a running run; retry after it finishes" });
          continue;
        }

        if (!opts.apply) {
          rows.push({
            loop: publicLoop(loop),
            workflow: publicWorkflow(workflow),
            status: "would_migrate",
            agentStepIds: migration.agentStepIds,
            nextWorkflowName,
            timeoutMs,
          });
          continue;
        }

        try {
          const migrated = store.createAndRetargetWorkflowLoop(loop.id, migration.body, {
            workflowTimeoutMs: timeoutMs,
            archiveOld: Boolean(opts.archiveOld),
          });
          rows.push({
            loop: publicLoop(migrated.loop),
            previousWorkflow: publicWorkflow(migrated.previousWorkflow),
            workflow: publicWorkflow(migrated.workflow),
            archivedOld: migrated.archivedOld ? publicWorkflow(migrated.archivedOld) : undefined,
            status: "migrated",
            agentStepIds: migration.agentStepIds,
            timeoutMs,
          });
        } catch (error) {
          rows.push({
            loop: publicLoop(loop),
            workflow: publicWorkflow(workflow),
            status: "blocked",
            reason: migrationErrorReason(error),
            agentStepIds: migration.agentStepIds,
            timeoutMs,
          });
        }
      }

      const summary = {
        apply: Boolean(opts.apply),
        timeoutMs,
        total: rows.length,
        migrated: rows.filter((row) => row.status === "migrated").length,
        updated: rows.filter((row) => row.status === "updated").length,
        wouldMigrate: rows.filter((row) => row.status === "would_migrate").length,
        wouldUpdate: rows.filter((row) => row.status === "would_update").length,
        blocked: rows.filter((row) => row.status === "blocked").length,
        skipped: rows.filter((row) => row.status === "skipped").length,
      };
      print({ summary, rows }, opts.apply ? `migrated=${summary.migrated} updated=${summary.updated} blocked=${summary.blocked} skipped=${summary.skipped}` : `would_migrate=${summary.wouldMigrate} would_update=${summary.wouldUpdate} blocked=${summary.blocked} skipped=${summary.skipped}`);
    } finally {
      store.close();
    }
  }));

workflows
  .command("migrate-goal-wrappers")
  .description("append-only migrate active workflow loops away from workflow-level goal wrappers")
  .option("--loop <idOrName>", "migrate only one loop instead of all active workflow loops")
  .option("--apply", "create new workflow specs and retarget eligible loops")
  .option("--archive-old", "archive old workflow specs after retargeting when no active loops still reference them")
  .action(runAction((opts) => {
    const store = new Store();
    try {
      const candidateLoops = opts.loop
        ? [store.requireUniqueLoop(opts.loop)]
        : store.listLoops({ status: "active", limit: 10_000 }).filter((loop) => loop.target.type === "workflow");
      const rows: Array<Record<string, unknown>> = [];

      for (const loop of candidateLoops) {
        if (loop.archivedAt) {
          rows.push({ loop: publicMigrationLoopSummary(loop), status: "skipped", reason: "loop is archived" });
          continue;
        }
        if (loop.target.type !== "workflow") {
          rows.push({ loop: publicMigrationLoopSummary(loop), status: "skipped", reason: "loop is not a workflow loop" });
          continue;
        }
        const workflow = store.requireWorkflow(loop.target.workflowId);
        if (!loop.goal) {
          rows.push({
            loop: publicMigrationLoopSummary(loop),
            workflow: publicMigrationWorkflowSummary(workflow),
            status: "skipped",
            reason: "loop has no loop-level goal wrapper",
          });
          continue;
        }
        if (!workflow.goal) {
          rows.push({
            loop: publicMigrationLoopSummary(loop),
            workflow: publicMigrationWorkflowSummary(workflow),
            status: "skipped",
            reason: "workflow has no top-level goal wrapper",
          });
          continue;
        }
        const nextWorkflowName = workflowGoalWrapperMigrationName(workflow);
        if (store.hasRunningRun(loop.id)) {
          rows.push({
            loop: publicMigrationLoopSummary(loop),
            workflow: publicMigrationWorkflowSummary(workflow),
            status: "blocked",
            reason: "loop has a running run; retry after it finishes",
          });
          continue;
        }

        if (!opts.apply) {
          rows.push({
            loop: publicMigrationLoopSummary(loop),
            workflow: publicMigrationWorkflowSummary(workflow),
            status: "would_migrate",
            nextWorkflowName,
            removedGoal: publicMigrationGoalSummary(workflow.goal),
          });
          continue;
        }

        try {
          const migrated = store.cloneWorkflowWithoutGoalAndRetargetLoop(loop.id, {
            workflowName: nextWorkflowName,
            workflowTimeoutMs: loop.target.timeoutMs,
            archiveOld: Boolean(opts.archiveOld),
          });
          rows.push({
            loop: publicMigrationLoopSummary(migrated.loop),
            previousWorkflow: publicMigrationWorkflowSummary(migrated.previousWorkflow),
            workflow: publicMigrationWorkflowSummary(migrated.workflow),
            archivedOld: migrated.archivedOld ? publicMigrationWorkflowSummary(migrated.archivedOld) : undefined,
            status: "migrated",
          });
        } catch (error) {
          rows.push({
            loop: publicMigrationLoopSummary(loop),
            workflow: publicMigrationWorkflowSummary(workflow),
            status: "blocked",
            reason: migrationErrorReason(error),
          });
        }
      }

      const summary = {
        apply: Boolean(opts.apply),
        total: rows.length,
        migrated: rows.filter((row) => row.status === "migrated").length,
        wouldMigrate: rows.filter((row) => row.status === "would_migrate").length,
        blocked: rows.filter((row) => row.status === "blocked").length,
        skipped: rows.filter((row) => row.status === "skipped").length,
      };
      print({ summary, rows }, opts.apply ? `migrated=${summary.migrated} blocked=${summary.blocked} skipped=${summary.skipped}` : `would_migrate=${summary.wouldMigrate} blocked=${summary.blocked} skipped=${summary.skipped}`);
    } finally {
      store.close();
    }
  }));

workflows.command("archive <idOrName>").description("archive a workflow spec without deleting runs").action(runAction((idOrName) => {
  const store = new Store();
  try {
    const workflow = store.archiveWorkflow(idOrName);
    print(publicWorkflow(workflow), `${workflow.id} ${workflow.status}`);
  } finally {
    store.close();
  }
}));

program
  .command("list")
  .alias("ls")
  .description("list loops with schedule and next-run summaries")
  .option("--status <status>", "filter by status")
  .option("--archived", "show only archived loops")
  .option("--all", "include archived loops")
  .action(runAction((opts) => {
    if (opts.archived && opts.all) throw new ValidationError("use either --archived or --all, not both");
    const store = new Store();
    try {
      const loops = store.listLoops({ status: opts.status, archived: opts.archived, includeArchived: opts.all });
      if (isJson()) print(loops.map(publicLoop));
      else {
        for (const loop of loops) {
          const machine = loop.machine ? `  machine=${loop.machine.id}` : "";
          const archive = loop.archivedAt ? `  archived=${loop.archivedAt} from=${loop.archivedFromStatus ?? "-"}` : "";
          console.log(`${loop.id}  ${loop.status.padEnd(7)}  cadence=${scheduleLabel(loop.schedule)}  next=${loop.nextRunAt ?? "-"}  ${loop.name}${machine}${archive}`);
        }
      }
    } finally {
      store.close();
    }
  }));

program
  .command("ui")
  .description("open a live table of active loops")
  .option("--refresh <duration>", "refresh interval", "2s")
  .action(runAction(async (opts: { refresh?: string }) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error("OpenLoops UI requires a TTY terminal.");
      console.error("Use `loops list`, `loops runs`, or `loops daemon status` non-interactively.");
      process.exitCode = 1;
      return;
    }
    const refreshMs = Math.max(500, parseDuration(opts.refresh ?? "2s"));
    await runLoopsUiApp({ refreshMs });
  }));

program.command("show <idOrName>").description("show one loop by id or name").action(runAction((idOrName) => {
  const store = new Store();
  try {
    print(publicLoop(store.requireLoop(idOrName)));
  } finally {
    store.close();
  }
}));

program
  .command("runs [idOrName]")
  .description("list recent runs, optionally for one loop")
  .option("--limit <n>", "limit", "50")
  .option("--show-output", "show stdout/stderr")
  .action(runAction((idOrName, opts) => {
    const store = new Store();
    try {
      const loop = idOrName ? store.requireLoop(idOrName) : undefined;
      const runs = store.listRuns({ loopId: loop?.id, limit: positiveInteger(opts.limit, "--limit") ?? 50 });
      if (isJson()) print(runs.map((run) => publicRun(run, opts.showOutput)));
      else {
        for (const run of runs) {
          console.log(
            `${run.id}  ${run.status.padEnd(10)}  attempt=${run.attempt}  slot=${run.scheduledFor}  ${run.loopName}`,
          );
          if (opts.showOutput) printTextOutput(run);
        }
      }
    } finally {
      store.close();
    }
  }));

program
  .command("expectations [idOrName]")
  .description("evaluate deterministic loop expectations without mutating external task systems")
  .option("--limit <n>", "maximum loops to inspect when no loop is specified", "200")
  .action(runAction((idOrName, opts) => {
    const store = new Store();
    try {
      const loops = idOrName ? [store.requireLoop(idOrName)] : store.listLoops({ limit: positiveInteger(opts.limit, "--limit") ?? 200 });
      const values = loops.map((loop) => expectationForLoop(store, loop));
      if (isJson()) console.log(JSON.stringify(idOrName ? values[0] : values, null, 2));
      else {
        for (const value of values) {
          console.log(`${value.ok ? "ok" : "fail"}  ${value.loop.name}  ${value.check.message}`);
          if (value.failure) console.log(`  classification=${value.failure.classification} fingerprint=${value.failure.fingerprint}`);
        }
      }
      if (values.some((value) => !value.ok)) process.exitCode = 1;
    } finally {
      store.close();
    }
  }));

const health = program
  .command("health")
  .description("summarize loop health and latest-run expectation status")
  .action(runAction(() => {
    const store = new Store();
    try {
      const report = buildHealthReport(store);
      if (isJson()) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(
          `loops=${report.summary.loops} healthy=${report.summary.healthy} unhealthy=${report.summary.unhealthy} warnings=${report.summary.warnings}`,
        );
        for (const expectation of report.expectations.filter((entry) => !entry.ok)) {
          console.log(
            `fail  ${expectation.loop.name}  ${expectation.failure?.classification ?? "unknown"}  ${expectation.failure?.fingerprint ?? "-"}`,
          );
        }
      }
      if (!report.ok) process.exitCode = 1;
    } finally {
      store.close();
    }
  }));

health
  .command("scan")
  .description("scan OpenLoops health, write bounded reports, and optionally upsert deduped todos findings")
  .option("--include <statuses>", "comma-separated loop statuses to inventory: active,paused,stopped,expired,all", "active,paused")
  .option("--limit <n>", "maximum loops to inspect", "200")
  .option("--max-findings <n>", "maximum findings to include in output", "100")
  .option("--latest-run", "include latest-run and stale-running checks")
  .option("--no-latest-run", "skip latest-run and stale-running checks")
  .option("--stale-running-after <duration>", "minimum age before a running latest run is stale; loop lease and 10m still apply")
  .option("--doctor", "include doctor/preflight checks")
  .option("--daemon", "include daemon status")
  .option("--start-daemon", "safe self-heal: start the daemon if it is not running")
  .option("--report-dir <path>", "write summary.json and report.md under this reports root")
  .option("--evidence-dir <path>", "alias for --report-dir and todo evidence output")
  .option("--upsert-todos", "upsert deduped todos tasks for scan findings")
  .option("--project <path>", "todos project path for --upsert-todos", defaultLoopsProject())
  .option("--task-list <slug>", "todos task-list slug for --upsert-todos", "loop-error-self-heal")
  .option("--max-actions <n>", "maximum todos tasks to upsert", "5")
  .option("--dry-run", "with --upsert-todos, print intended task upserts without mutating todos")
  .option("--auto-route", "with --upsert-todos, opt routed tasks into task-created headless worker/verifier automation")
  .option("--route-project-path <path>", "fallback project path for --auto-route when the finding has no cwd")
  .option("-j, --json", "print JSON for this command")
  .action(runAction(async (opts) => {
    const store = new Store();
    try {
      const includeStatuses = parseLoopStatuses(opts.include, "--include");
      let daemon = (opts.daemon || opts.startDaemon) ? daemonStatus(store) : undefined;
      const selfHeals = [];
      if (opts.startDaemon) {
        if (daemon?.running) {
          selfHeals.push({
            kind: "daemon-start" as const,
            attempted: false,
            ok: true,
            reason: "daemon already running",
          });
        } else {
          const result = await startDaemon({ cliEntry: process.argv[1] ?? "loops" });
          const ok = Boolean(result.started || result.alreadyRunning);
          selfHeals.push({
            kind: "daemon-start" as const,
            attempted: true,
            ok,
            reason: daemon?.stale ? "daemon pid file was stale" : "daemon was not running",
            result: result as unknown as Record<string, unknown>,
          });
          daemon = daemonStatus(store);
        }
      }

      let scan = writeHealthScanReports(
        buildHealthScan(store, {
          includeStatuses,
          limit: positiveInteger(opts.limit, "--limit") ?? 200,
          maxFindings: nonNegativeInteger(opts.maxFindings, "--max-findings") ?? 100,
          latestRun: opts.latestRun !== false,
          staleRunningMs: opts.staleRunningAfter ? positiveDuration(opts.staleRunningAfter, "--stale-running-after") : undefined,
          doctor: opts.doctor ? runDoctor(store) : undefined,
          daemon,
          selfHeals,
        }),
        { reportDir: opts.reportDir ?? opts.evidenceDir },
      );

      if (opts.upsertTodos) {
        const tasks = scan.findings
          .filter((finding) => finding.recommendedTask)
          .map((finding) => {
            const task = finding.recommendedTask!;
            const description = [
              task.description,
              scan.reports ? `Report: ${scan.reports.markdown}` : undefined,
            ].filter(Boolean).join("\n\n");
            return {
              title: task.title,
              description,
              priority: task.priority,
              tags: task.tags,
              fingerprint: task.dedupeKey,
              extra: {
                kind: finding.kind,
                severity: finding.severity,
                classification: finding.classification,
              },
              metadata: {
                source: "openloops.health.scan",
                kind: finding.kind,
                severity: finding.severity,
                loop_id: finding.loop?.id,
                loop_name: finding.loop?.name,
                loop_status: finding.loop?.status,
                run_id: finding.run?.id,
                classification: finding.classification,
                fingerprint: task.dedupeKey,
                cwd: finding.route?.cwd,
                provider: finding.route?.provider,
                report_dir: scan.reports?.dir,
                no_tmux_dispatch: true,
              },
            };
          });
        const result = upsertRouteTasks({
          project: opts.project,
          taskList: {
            slug: opts.taskList,
            name: "Loop Error Self Heal",
            description: "Deduped OpenLoops health scan findings for daemon, doctor, preflight, latest-run, and stale-running issues.",
          },
          cursorKey: routeCursorKey(
            "health",
            ["scan", opts.project, opts.taskList, includeStatuses.join(","), opts.limit, Boolean(opts.doctor), Boolean(opts.daemon)],
            { autoRoute: Boolean(opts.autoRoute), routeProjectPath: opts.routeProjectPath },
          ),
          maxActions: positiveInteger(opts.maxActions, "--max-actions") ?? 5,
          dryRun: Boolean(opts.dryRun),
          autoRoute: Boolean(opts.autoRoute),
          routeProjectPath: opts.routeProjectPath,
          source: "openloops.health.scan",
          evidence: { kind: "health-scan-route-tasks", dir: opts.evidenceDir ?? opts.reportDir },
          summary: {
            status: scan.status,
            inspected: scan.counts.loops,
            findings: scan.counts.findings,
            reportDir: scan.reports?.dir,
          },
          tasks,
        });
        scan = { ...scan, todos: result.output };
        if (!result.ok) process.exitCode = 1;
      }

      const jsonMode = isJson() || Boolean(opts.json);
      if (jsonMode) console.log(JSON.stringify(compactHealthScanOutput(scan), null, 2));
      else {
        const actions = Array.isArray(scan.todos?.actions) ? scan.todos.actions as Array<Record<string, unknown>> : [];
        console.log(
          `health_scan status=${scan.status} loops=${scan.counts.loops} findings=${scan.counts.findings} ` +
            `reported=${scan.counts.reportedFindings} truncated=${scan.counts.truncatedFindings} ` +
            `latest=${scan.counts.latestRunFindings} stale_running=${scan.counts.staleRunning} ` +
            `daemon=${scan.counts.daemonFindings} doctor=${scan.counts.doctorFindings} preflight=${scan.counts.preflightFindings} ` +
            `report=${scan.reports?.markdown ?? "none"} todos_actions=${actions.length}`,
        );
        for (const finding of scan.findings) {
          console.log(`${finding.severity} ${finding.kind} ${finding.fingerprint} ${finding.loop?.name ?? ""} ${finding.message}`);
        }
      }
      if (!process.exitCode && scan.status !== "ok") process.exitCode = scan.status === "critical" ? 2 : 1;
    } finally {
      store.close();
    }
  }));

health
  .command("route-tasks")
  .description("upsert deduped todos tasks for failed loop health expectations")
  .option("--project <path>", "todos project path", defaultLoopsProject())
  .option("--task-list <slug>", "todos task-list slug", "loop-error-self-heal")
  .option("--limit <n>", "maximum loops to inspect", "200")
  .option("--max-actions <n>", "maximum todos tasks to upsert", "5")
  .option("--include-inactive", "also route stopped or expired loops")
  .option("--auto-route", "opt routed tasks into task-created headless worker/verifier automation")
  .option("--route-project-path <path>", "fallback project path for --auto-route when the failed loop has no cwd")
  .option("--evidence-dir <path>", "write the route result JSON to this directory")
  .option("--dry-run", "print intended task upserts without mutating todos")
  .action(runAction((opts) => {
    const store = new Store();
    try {
      const report = buildHealthReport(store, { limit: positiveInteger(opts.limit, "--limit") ?? 200, includeInactive: Boolean(opts.includeInactive) });
      const failures = report.expectations.filter((entry) => !entry.ok && entry.recommendedTask);
      const result = upsertRouteTasks({
        project: opts.project,
        taskList: {
          slug: opts.taskList,
          name: "Loop Error Self Heal",
          description: "Deduped OpenLoops health expectation failures routed by loops health route-tasks.",
        },
        cursorKey: routeCursorKey("health", [opts.project, opts.taskList, opts.limit, Boolean(opts.includeInactive)], {
          autoRoute: Boolean(opts.autoRoute),
          routeProjectPath: opts.routeProjectPath,
        }),
        maxActions: positiveInteger(opts.maxActions, "--max-actions") ?? 5,
        dryRun: Boolean(opts.dryRun),
        autoRoute: Boolean(opts.autoRoute),
        routeProjectPath: opts.routeProjectPath,
        source: "openloops.health.route-tasks",
        evidence: { kind: "health-route-tasks", dir: opts.evidenceDir },
        summary: { inspected: report.summary.loops, failures: failures.length },
        tasks: failures.map((expectation) => {
          const task = expectation.recommendedTask!;
          return {
            title: task.title,
            description: task.description,
            priority: task.priority,
            tags: task.tags,
            fingerprint: task.dedupeKey,
            metadata: {
              source: "openloops.health.route-tasks",
              loop_id: expectation.loop.id,
              loop_name: expectation.loop.name,
              run_id: expectation.latestRun?.id,
              classification: expectation.failure?.classification,
              fingerprint: task.dedupeKey,
              cwd: expectation.route.cwd,
              provider: expectation.route.provider,
              no_tmux_dispatch: true,
            },
          };
        }),
      });
      const output = result.output;
      const actions = output.actions as Array<Record<string, unknown>>;
      if (isJson()) console.log(JSON.stringify(output, null, 2));
      else {
        console.log(`health_route_tasks inspected=${output.inspected} failures=${output.failures} actions=${actions.length}`);
        if (result.evidencePath) console.log(`evidence=${result.evidencePath}`);
        for (const action of actions) console.log(`${action.action} ${action.fingerprint}`);
      }
      if (!result.ok) process.exitCode = 1;
    } finally {
      store.close();
    }
  }));

const hygiene = program.command("hygiene").description("deterministic OpenLoops hygiene checks and safe repairs");

hygiene
  .command("names")
  .description("check or apply canonical machine-/repo-prefixed loop names")
  .option("--apply", "rename loops in-place")
  .option("--include-stopped", "include stopped loops")
  .option("--include-inactive", "include stopped, expired, and archived loops")
  .option("--limit <n>", "maximum loops to inspect", "1000")
  .action(runAction((opts) => {
    const store = new Store();
    try {
      const report = buildNameHygieneReport(store, {
        apply: false,
        includeStopped: Boolean(opts.includeStopped),
        includeInactive: Boolean(opts.includeInactive),
        limit: positiveInteger(opts.limit, "--limit") ?? 1000,
      });
      let outputReport = report;
      const backupPath = opts.apply && report.changed > 0 ? backupLoopsDatabase("name-hygiene") : undefined;
      if (opts.apply && report.changed > 0) {
        outputReport = buildNameHygieneReport(store, {
          apply: true,
          includeStopped: Boolean(opts.includeStopped),
          includeInactive: Boolean(opts.includeInactive),
          limit: positiveInteger(opts.limit, "--limit") ?? 1000,
        });
      } else if (opts.apply) {
        outputReport = { ...report, applied: true };
      }
      const output = backupPath ? { ...outputReport, backupPath } : outputReport;
      if (isJson()) console.log(JSON.stringify(output, null, 2));
      else {
        console.log(`hygiene_names checked=${outputReport.checked} changed=${outputReport.changed} applied=${outputReport.applied}`);
        if (backupPath) console.log(`backup=${backupPath}`);
        for (const change of outputReport.changes.filter((entry) => entry.changed)) {
          console.log(`${outputReport.applied ? "renamed" : "would-rename"} ${change.id} ${change.oldName} -> ${change.newName}`);
        }
      }
      if (!outputReport.ok && !outputReport.applied) process.exitCode = 1;
    } finally {
      store.close();
    }
  }));

hygiene
  .command("duplicates")
  .description("detect duplicate/overlapping loops with the same canonical name, cwd, and schedule")
  .option("--include-inactive", "include stopped, expired, and archived loops")
  .option("--limit <n>", "maximum loops to inspect", "1000")
  .action(runAction((opts) => {
    const store = new Store();
    try {
      const report = buildDuplicateOverlapReport(store, {
        includeInactive: Boolean(opts.includeInactive),
        limit: positiveInteger(opts.limit, "--limit") ?? 1000,
      });
      if (isJson()) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(`hygiene_duplicates checked=${report.checked} groups=${report.groups.length}`);
        for (const group of report.groups) {
          console.log(`${group.key}\t${group.loops.map((loop) => `${loop.id}:${loop.status}:${loop.name}`).join(",")}`);
        }
      }
      if (!report.ok) process.exitCode = 1;
    } finally {
      store.close();
    }
  }));

hygiene
  .command("scripts")
  .description("inventory loops still backed by local ~/.hasna/loops/scripts commands")
  .option("--scripts-dir <path>", "script directory to detect")
  .option("--include-inactive", "include stopped, expired, and archived loops")
  .option("--limit <n>", "maximum loops to inspect", "1000")
  .action(runAction((opts) => {
    const store = new Store();
    try {
      const report = buildScriptInventoryReport(store, {
        scriptsDir: opts.scriptsDir,
        includeInactive: Boolean(opts.includeInactive),
        limit: positiveInteger(opts.limit, "--limit") ?? 1000,
      });
      if (isJson()) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(`hygiene_scripts checked=${report.checked} script_backed=${report.scriptBacked}`);
        for (const loop of report.loops) console.log(`${loop.id}\t${loop.status}\t${loop.name}\t${loop.command}`);
      }
      if (!report.ok) process.exitCode = 1;
    } finally {
      store.close();
    }
  }));

hygiene
  .command("route-tasks")
  .description("upsert deduped todos tasks for hygiene findings")
  .option("--checks <list>", "comma-separated hygiene checks: names,duplicates,scripts,all", "all")
  .option("--project <path>", "todos project path", defaultLoopsProject())
  .option("--task-list <slug>", "todos task-list slug", "openloops-hygiene")
  .option("--limit <n>", "maximum loops to inspect", "1000")
  .option("--max-actions <n>", "maximum todos tasks to upsert", "10")
  .option("--scripts-dir <path>", "script directory to detect for script inventory")
  .option("--include-inactive", "also route stopped, expired, or archived loops")
  .option("--auto-route", "opt routed tasks into task-created headless worker/verifier automation")
  .option("--route-project-path <path>", "fallback project path for --auto-route when the hygiene finding has no cwd")
  .option("--evidence-dir <path>", "write the route result JSON to this directory")
  .option("--dry-run", "print intended task upserts without mutating todos")
  .action(runAction((opts) => {
    const store = new Store();
    try {
      const checks = parseHygieneChecks(opts.checks);
      const route = buildHygieneRouteTasks(store, {
        checks,
        includeInactive: Boolean(opts.includeInactive),
        limit: positiveInteger(opts.limit, "--limit") ?? 1000,
        scriptsDir: opts.scriptsDir,
      });
      const result = upsertRouteTasks({
        project: opts.project,
        taskList: {
          slug: opts.taskList,
          name: "OpenLoops Hygiene",
          description: "Deduped OpenLoops hygiene findings routed by loops hygiene route-tasks.",
        },
        cursorKey: routeCursorKey("hygiene", [opts.project, opts.taskList, checks, opts.limit, Boolean(opts.includeInactive), opts.scriptsDir ?? ""], {
          autoRoute: Boolean(opts.autoRoute),
          routeProjectPath: opts.routeProjectPath,
        }),
        maxActions: positiveInteger(opts.maxActions, "--max-actions") ?? 10,
        dryRun: Boolean(opts.dryRun),
        autoRoute: Boolean(opts.autoRoute),
        routeProjectPath: opts.routeProjectPath,
        source: "openloops.hygiene.route-tasks",
        evidence: { kind: "hygiene-route-tasks", dir: opts.evidenceDir },
        summary: { checks, checked: route.checked, findings: route.findings },
        tasks: route.tasks.map((task) => ({
          title: task.title,
          description: task.description,
          priority: task.priority,
          tags: task.tags,
          fingerprint: task.fingerprint,
          metadata: task.metadata,
          extra: { check: task.check },
        })),
      });
      const output = result.output;
      const actions = output.actions as Array<Record<string, unknown>>;
      if (isJson()) console.log(JSON.stringify(output, null, 2));
      else {
        console.log(`hygiene_route_tasks checks=${checks.join(",")} findings=${output.findings} actions=${actions.length}`);
        if (result.evidencePath) console.log(`evidence=${result.evidencePath}`);
        for (const action of actions) console.log(`${action.action} ${action.fingerprint}`);
      }
      if (!result.ok) process.exitCode = 1;
    } finally {
      store.close();
    }
  }));

program.command("pause <idOrName>").description("pause an active loop without losing its schedule").action(runAction((idOrName) => updateStatus(idOrName, "paused")));
program.command("resume <idOrName>").description("resume a paused or stopped loop").action(runAction((idOrName) => updateStatus(idOrName, "active")));
program.command("stop <idOrName>").description("stop a loop and clear its next scheduled run").action(runAction((idOrName) => updateStatus(idOrName, "stopped")));

program
  .command("rename <idOrName> <newName>")
  .description("rename a loop without changing its id, schedule, runs, or history")
  .action(runAction((idOrName, newName) => {
    const store = new Store();
    try {
      const loop = store.requireUniqueLoop(idOrName);
      const oldName = loop.name;
      const trimmed = String(newName).trim();
      if (!trimmed) throw new ValidationError("loop name must not be empty");

      const existing = store.findLoopByName(trimmed);
      if (existing && existing.id !== loop.id) {
        throw new ValidationError(`loop name already exists: ${trimmed} (${existing.id})`);
      }

      if (trimmed === oldName) {
        print(
          {
            changed: false,
            id: loop.id,
            oldName,
            newName: oldName,
            loop: publicLoop(loop),
          },
          `${loop.id} unchanged (${oldName})`,
        );
        return;
      }

      const backupPath = backupLoopsDatabase("rename");
      const renamed = store.renameLoop(loop.id, trimmed);
      print(
        {
          changed: true,
          id: renamed.id,
          oldName,
          newName: renamed.name,
          backupPath,
          loop: publicLoop(renamed),
        },
        `${renamed.id} renamed ${oldName} -> ${renamed.name}\nbackup=${backupPath ?? "skipped (recent rename backup exists)"}`,
      );
    } finally {
      store.close();
    }
  }));

function updateStatus(idOrName: string, status: "paused" | "active" | "stopped"): void {
  const store = new Store();
  try {
    // requireUniqueLoop so an ambiguous name errors instead of mutating the
    // newest same-named loop.
    const loop = store.requireUniqueLoop(idOrName);
    if (loop.archivedAt) throw new Error(`loop is archived; run 'loops unarchive ${idOrName}' first`);
    let nextRunAt = loop.nextRunAt;
    if (status === "stopped") {
      nextRunAt = undefined;
    } else if (status === "active" && !loop.nextRunAt) {
      // Resuming a stopped loop leaves next_run_at NULL, so dueLoops (which
      // requires next_run_at IS NOT NULL) would never pick it up: the loop is
      // "active" but permanently dormant. Recompute the next slot from now.
      const now = new Date();
      nextRunAt = computeNextAfter(loop.schedule, now, now);
    }
    const updated = store.updateLoop(loop.id, { status, nextRunAt });
    print(publicLoop(updated), `${updated.id} ${updated.status}`);
  } finally {
    store.close();
  }
}

program
  .command("remove <idOrName>")
  .alias("rm")
  .description("delete a loop and its run history")
  .action(runAction((idOrName) => {
    const store = new Store();
    try {
      // requireUniqueLoop so an ambiguous name errors instead of deleting the
      // newest same-named loop.
      const removed = store.deleteLoop(store.requireUniqueLoop(idOrName).id);
      print({ removed }, removed ? "removed" : "not removed");
    } finally {
      store.close();
    }
  }));

program.command("archive <idOrName>").description("archive a loop without deleting history").action(runAction((idOrName) => {
  const store = new Store();
  try {
    const loop = store.archiveLoop(idOrName);
    print(publicLoop(loop), `${loop.id} archived`);
  } finally {
    store.close();
  }
}));

program.command("unarchive <idOrName>").alias("restore").description("restore an archived loop").action(runAction((idOrName) => {
  const store = new Store();
  try {
    const loop = store.unarchiveLoop(idOrName);
    print(publicLoop(loop), `${loop.id} ${loop.status}`);
  } finally {
    store.close();
  }
}));

program
  .command("run-now <idOrName>")
  .description("claim and execute one loop run immediately")
  .option("--show-output", "show stdout/stderr")
  .action(runAction(async (idOrName, opts) => {
    const store = new Store();
    try {
      const loop = store.requireUniqueLoop(idOrName);
      if (loop.archivedAt) throw new Error(`loop is archived; run 'loops unarchive ${idOrName}' before running it`);
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
      const value = { ...publicRun(run, opts.showOutput), runNow: { source, advancesLoop: shouldAdvance } };
      print(value, `${run.id} ${run.status} source=${source} slot=${run.scheduledFor}`);
      if (!isJson() && opts.showOutput) printTextOutput(run);
      if (run.status !== "succeeded") process.exitCode = 1;
    } finally {
      store.close();
    }
  }));

program.command("tick").description("run one scheduler tick").action(runAction(async () => {
  const store = new Store();
  try {
    const result = await tick({ store, runnerId: `manual-tick:${process.pid}` });
    print(result, `completed=${result.completed.length} skipped=${result.skipped.length} recovered=${result.recovered.length}`);
  } finally {
    store.close();
  }
}));

program.command("doctor").description("check local OpenLoops runtime dependencies and state").action(runAction(() => {
  const store = new Store();
  try {
    const report = runDoctor(store);
    if (isJson()) print(report);
    else {
      for (const check of report.checks) {
        const marker = check.status === "ok" ? "ok" : check.status === "warn" ? "warn" : "fail";
        console.log(`${marker.padEnd(4)} ${check.id.padEnd(22)} ${check.message}${check.detail ? ` (${check.detail})` : ""}`);
      }
    }
    if (!report.ok) process.exitCode = 1;
  } finally {
    store.close();
  }
}));

/** Managed backup files: `loops-<slug>-<iso stamp>.db` (lib/backup) and legacy `loops.db.bak-<reason>-<stamp>`. */
function listManagedBackups(dir: string): Array<{ path: string; group: string; timeMs: number }> {
  if (!existsSync(dir)) return [];
  const entries: Array<{ path: string; group: string; timeMs: number }> = [];
  for (const name of readdirSync(dir)) {
    const modern = /^loops-(.+)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/.exec(name);
    const legacy = /^loops\.db\.bak-(.+)-\d{8}T\d{6}Z$/.exec(name);
    const group = modern ? `reason:${modern[1]}` : legacy ? `legacy:${legacy[1]}` : undefined;
    if (!group) continue;
    const path = join(dir, name);
    try {
      entries.push({ path, group, timeMs: statSync(path).mtimeMs });
    } catch {
      /* file disappeared mid-scan */
    }
  }
  return entries;
}

function listStrayTempFiles(dirs: string[]): string[] {
  const stray: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".tmp")) continue;
      const path = join(dir, name);
      try {
        if (statSync(path).isFile()) stray.push(path);
      } catch {
        /* file disappeared mid-scan */
      }
    }
  }
  return stray;
}

program
  .command("gc")
  .description("prune old run history, rotate database backups, checkpoint the WAL, and remove stray temp files in the data dir")
  .option("--max-age-days <n>", "delete terminal runs older than this many days", "30")
  .option("--keep-per-loop <n>", "always retain this many most recent runs per loop", "20")
  .option("--backup-keep <n>", "database backups to retain per backup reason", "3")
  .option("--dry-run", "preview deletions without changing anything (default)")
  .option("--apply", "actually delete history, prune backups, checkpoint, and remove stray files")
  .action(runAction((opts) => {
    if (opts.dryRun && opts.apply) throw new ValidationError("choose either --dry-run or --apply, not both");
    const dryRun = !opts.apply;
    const maxAgeDays = nonNegativeInteger(opts.maxAgeDays, "--max-age-days");
    const keepPerLoop = nonNegativeInteger(opts.keepPerLoop, "--keep-per-loop");
    const backupKeep = positiveInteger(opts.backupKeep, "--backup-keep") ?? 3;

    const store = new Store();
    let history;
    try {
      history = store.pruneHistory({ maxAgeDays, keepPerLoop, dryRun });
    } finally {
      store.close();
    }

    const backupsDir = join(dataDir(), "backups");
    const grouped = new Map<string, Array<{ path: string; timeMs: number }>>();
    for (const entry of listManagedBackups(backupsDir)) {
      const group = grouped.get(entry.group) ?? [];
      group.push(entry);
      grouped.set(entry.group, group);
    }
    const prunedBackups: string[] = [];
    let keptBackups = 0;
    for (const group of grouped.values()) {
      group.sort((a, b) => b.timeMs - a.timeMs);
      keptBackups += Math.min(group.length, backupKeep);
      for (const entry of group.slice(backupKeep)) prunedBackups.push(entry.path);
    }
    const strayFiles = listStrayTempFiles([dataDir(), backupsDir]);
    if (!dryRun) {
      for (const path of [...prunedBackups, ...strayFiles]) rmSync(path, { force: true });
    }

    let walCheckpoint: Record<string, unknown> = { ran: false };
    if (!dryRun && existsSync(dbPath())) {
      const db = new Database(dbPath());
      try {
        const result = db.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as Record<string, unknown> | null;
        walCheckpoint = { ran: true, ...(result ?? {}) };
      } catch (error) {
        walCheckpoint = { ran: false, error: redact(error instanceof Error ? error.message : String(error), 240) };
      } finally {
        db.close();
      }
    }

    const value = {
      dryRun,
      dataDir: dataDir(),
      history,
      backups: { keep: backupKeep, kept: keptBackups, pruned: prunedBackups },
      strayFiles,
      walCheckpoint,
    };
    print(
      value,
      `gc ${dryRun ? "dry-run" : "applied"}: loopRuns=${history.loopRuns} workflowRuns=${history.workflowRuns} goalRuns=${history.goalRuns} backupsPruned=${prunedBackups.length} strayFiles=${strayFiles.length}${dryRun ? " (use --apply to execute)" : ""}`,
    );
  }));

const daemon = program.command("daemon").description("manage the local daemon");

daemon
  .command("run")
  .description("run the scheduler daemon in the foreground")
  .option("--interval-ms <ms>", "tick interval", (value) => Number(value))
  .action(runAction(async (opts) => runDaemon({ intervalMs: opts.intervalMs })));

daemon.command("start").description("start the daemon in the background").action(runAction(async () => {
  const result = await startDaemon({ cliEntry: process.argv[1] ?? "loops" });
  print(result, result.alreadyRunning ? `already running pid=${result.pid}` : result.started ? `started pid=${result.pid}` : "failed to start");
}));

daemon.command("stop").description("stop the background daemon").action(runAction(async () => {
  const result = await stopDaemon();
  print(result, result.stopped ? `stopped pid=${result.pid}` : "not running");
}));

daemon.command("status").description("show daemon lease/heartbeat status").action(runAction(() => {
  const store = new Store();
  try {
    print(daemonStatus(store));
  } finally {
    store.close();
  }
}));

daemon
  .command("install")
  .description("write a systemd user service or launchd plist")
  .option("--enable", "also enable/start the user service when supported")
  .action(runAction((opts) => {
    const result = installStartup(process.argv[1] ?? "loops");
    if (opts.enable) result.enableResults = enableStartup(result);
    const enableText = result.enableResults
      ? `\n${result.enableResults.map((item) => `${item.command} -> ${item.status === 0 ? "ok" : `exit ${item.status}`}`).join("\n")}`
      : "";
    print(result, `wrote ${result.path}\n${result.instructions.join("\n")}${enableText}`);
  }));

daemon
  .command("logs")
  .description("print the tail of the daemon log")
  .option("-n, --lines <n>", "lines", "80")
  // --tail is a documented alias the control room and docs use; commander would
  // otherwise reject it as an unknown option.
  .option("--tail <n>", "alias for --lines")
  .action(runAction((opts) => {
    const path = daemonLogPath();
    if (!existsSync(path)) {
      console.log("");
      return;
    }
    // Validate n so a bad value ('abc') errors instead of NaN -> slice(0) dumping
    // the whole log. --tail wins when both are supplied.
    const count = positiveInteger(opts.tail ?? opts.lines, opts.tail !== undefined ? "--tail" : "--lines") ?? 80;
    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    console.log(lines.slice(-count).join("\n"));
  }));

await program.parseAsync(process.argv);
