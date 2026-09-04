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
  WriteRunReceiptInput,
} from "../types.js";
import { dataDir, daemonLogPath, dbPath } from "../lib/paths.js";
import {
  publicLoop,
  publicExecutorResult,
  publicGoal,
  publicGoalRun,
  publicRun,
  publicRunReceipt,
  publicWorkflow,
  publicWorkflowEvent,
  publicWorkflowInvocation,
  publicWorkflowRun,
  publicWorkflowStepRun,
  publicWorkflowWorkItem,
  redact,
  textOutputBlocks,
} from "../lib/format.js";
import { classifyLoopExecutionStaleness } from "../lib/execution-staleness.js";
import { publicCommandDescriptor } from "../lib/command-target.js";
import { initialNextRun, parseDuration } from "../lib/recurrence.js";
import { Store } from "../lib/store.js";
import { CloudUnsupportedError, getStore, isCloudStore, type LoopStore } from "../lib/store/index.js";
import { executeWorkflow, preflightWorkflow } from "../lib/workflow-runner.js";
import { runLoopNow, tick } from "../lib/scheduler.js";
import { daemonStatus, stopDaemon } from "../daemon/control.js";
import { runDaemon, startDaemon, stripAnsi } from "../daemon/daemon.js";
import { enableStartup, installStartup } from "../daemon/install.js";
import { normalizeGoalSpec } from "../lib/workflow-spec.js";
import { runDoctor } from "../lib/doctor.js";
import { buildHealthReport, buildHealthScan, expectationForLoop, writeHealthScanReports } from "../lib/health.js";
import { buildHostedDoctorReport, buildHostedHealthReport, buildHostedHealthScan } from "../lib/hosted-diagnostics.js";
import { isPrivateOperationEventType } from "../lib/operation-contract.js";
import type { LoopMutationEnvelope } from "../lib/operation-contract.js";
import { runLoopsUiApp } from "./ui.js";
import {
  applyControlPlanePush,
  applyImportMigrationBundle,
  buildControlPlaneMigrationPlan,
  buildImportMigrationPlan,
  exportLoopsMigrationBundle,
  publicMigrationBundle,
  validateLoopsMigrationBundle,
  type LoopsMigrationPlan,
} from "../lib/migration.js";
import { resolveRuntimeConfig } from "../lib/runtime-config.js";
import { buildStorageConnectionReport, storageConnectionReportLine, type StorageConnectionReport } from "../lib/runtime-status.js";
import {
  buildDuplicateOverlapReport,
  buildNameHygieneReport,
  buildScriptInventoryReport,
  buildStuckRunReport,
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
import { mergeLoopLabels, normalizeLoopLabels, removeLoopLabels } from "../lib/labels.js";
import {
  addAgentRoutingOptions,
  addRouteEventOptions,
  addTodosDrainOptions,
  applyRoutePolicyToDrainOptions,
  applyRoutePolicyToScheduleOptions,
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
  listRoutePolicies,
  routeCursorKey,
  routeDrainArgs,
  routeEventByKind,
  renderRoutePolicy,
  sandboxFromOpts,
  splitList,
  stringField,
  todosTaskRouteTemplateId,
  timeoutDuration,
  upsertRouteTasks,
  validateRoutePolicy,
  workflowBodyFromFile,
  workflowSpecForPreflight,
  type TodosDrainOptions,
  type TodosTaskRouteOptions,
} from "../lib/route/index.js";
import { sanitizeCliErrorContext } from "./safe-error-context.js";

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
  const safeMessage = redact(message, error instanceof GateError ? 320 : 640) ?? "";
  process.exitCode = 1;
  if (error instanceof GateError) {
    if (isJson()) {
      const safeContext = sanitizeCliErrorContext(error.context);
      print({
        ...safeContext,
        ok: false,
        created: false,
        [error.gate]: {
          ok: false,
          code: error.code,
          error: safeMessage,
        },
      });
      return;
    }
    console.error(`error: ${safeMessage}`);
    return;
  }
  if (isJson()) {
    print({ ok: false, error: { code: error instanceof CodedError ? error.code : "ERROR", message: safeMessage } });
  }
  console.error(`error: ${safeMessage}`);
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

/**
 * Resolve the client store (local sqlite OR the hosted `/v1` API) and run `fn`
 * against it, always closing afterwards. EVERY data command goes through here so
 * there is no per-command `if (cloud) … else new Store()` branch and no way to
 * silently touch the on-box island while the machine is flipped to cloud.
 */
async function withStore<T>(fn: (store: LoopStore) => Promise<T>): Promise<T> {
  const store = getStore();
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}

type LoopListOptions = NonNullable<Parameters<LoopStore["listLoops"]>[0]>;
const CLI_LOOP_LIST_PAGE_SIZE = 200;
const CLI_LOOP_LIST_MAX_PAGES = 1_000;
const CLI_LOOP_LIST_MAX_ITEMS = 100_000;

function loopListPaginationError(reason: string): CodedError {
  return new CodedError("LOOP_LIST_PAGINATION_FAILED", `loop list pagination failed: ${reason}`);
}

/**
 * A page that makes no progress (exact repeat, zero new ids, or a frozen
 * offset) is a legitimate terminal condition, not a CLI failure: the loops
 * table is ordered by `next_run_at`, which the daemon mutates as loops run, so
 * the ordering can shift between page fetches and the offset window can land
 * entirely on already-seen rows. Treating that as a hard error blocked loop
 * enumeration entirely; returning the deduplicated population gathered so far
 * unblocks it while the warning names why the population may be incomplete.
 */
function stopListAtNoProgress(loops: Loop[], reason: string): Loop[] {
  console.error(
    `warning: loop list pagination stopped after ${loops.length} loop(s): ${reason}; ` +
      "returning the deduplicated population gathered so far (may be incomplete if the backend reorders pages)",
  );
  return loops;
}

async function listAllLoops(
  store: LoopStore,
  opts: Omit<LoopListOptions, "limit" | "offset"> = {},
): Promise<Loop[]> {
  const loops: Loop[] = [];
  const seenIds = new Set<string>();
  let offset = 0;
  let pageCount = 0;
  let previousPageIds: string[] | undefined;
  while (true) {
    if (pageCount >= CLI_LOOP_LIST_MAX_PAGES) {
      throw loopListPaginationError(`exceeded the ${CLI_LOOP_LIST_MAX_PAGES}-page safety ceiling`);
    }
    const page = await store.listLoops({
      ...opts,
      limit: CLI_LOOP_LIST_PAGE_SIZE,
      offset,
    });
    pageCount += 1;
    if (page.length === 0) return loops;

    const pageIds = page.map((loop) => loop.id);
    if (
      previousPageIds?.length === pageIds.length &&
      pageIds.every((id, index) => id === previousPageIds![index])
    ) {
      return stopListAtNoProgress(loops, "the backend repeated a page");
    }

    let newIds = 0;
    for (const loop of page) {
      if (typeof loop.id !== "string" || loop.id.length === 0) {
        throw loopListPaginationError("the backend returned a loop without a usable id");
      }
      if (seenIds.has(loop.id)) continue;
      seenIds.add(loop.id);
      loops.push(loop);
      newIds += 1;
      if (loops.length > CLI_LOOP_LIST_MAX_ITEMS) {
        throw loopListPaginationError(`exceeded the ${CLI_LOOP_LIST_MAX_ITEMS}-item safety ceiling`);
      }
    }
    if (newIds === 0) return stopListAtNoProgress(loops, "a page contained no new loop ids");
    if (page.length < CLI_LOOP_LIST_PAGE_SIZE) return loops;

    const nextOffset = offset + page.length;
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) {
      return stopListAtNoProgress(loops, "the backend did not advance the page offset");
    }
    previousPageIds = pageIds;
    offset = nextOffset;
  }
}

/**
 * Guard for the on-box execution/maintenance commands (daemon lifecycle, WAL
 * checkpoint + backup rotation, tick, local migrations). These act on this
 * machine's runtime and sqlite file, so they are meaningless — and would
 * silently hit the local island — when the client is flipped to the hosted API.
 * Fail loudly instead. (`run-now` is NOT local-only: it routes through the
 * hosted endpoint and schedules the loop for a bound runner.)
 */
function assertLocalOnlyCommand(command: string): void {
  if (isCloudStore()) {
    throw new ValidationError(
      `'loops ${command}' operates on this machine's local runtime and is not available while flipped to the hosted Loops API. ` +
        `Unset HASNA_LOOPS_API_URL/HASNA_LOOPS_API_KEY to use the local file store and run it here.`,
    );
  }
}

/** `123456` -> `2m3s`, so an operator reads an unclaimed slot without doing arithmetic. */
function humanDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

function printUnchecked(unchecked: Array<{ id: string; reason: string }>): void {
  console.log("not checked:");
  for (const entry of unchecked) console.log(`  ${entry.id}: ${entry.reason}`);
}

/**
 * `loops health` against the hosted control plane. The banner and the
 * `not checked` block are not decoration: a hosted summary that does not say
 * which runtime it read, and what it did not read, is the defect this command
 * was refused for.
 */
async function hostedHealth(): Promise<void> {
  const store = getStore();
  try {
    const hosted = await buildHostedHealthReport(store);
    if (isJson()) console.log(JSON.stringify(hosted, null, 2));
    else {
      console.log(`backend  hosted control plane ${hosted.backend.apiUrl ?? "(url unavailable)"} (transport=${hosted.backend.transport})`);
      const summary = hosted.report.summary;
      const executionHealthy = hosted.executionTruth.filter((entry) => entry.state === "healthy").length;
      const deadCadence = hosted.executionTruth.filter((entry) => entry.state === "dead_cadence").length;
      const unproven = hosted.executionTruth.filter((entry) => entry.state === "unproven").length;
      console.log(
        `loops=${summary.loops} healthy=${summary.healthy} unhealthy=${summary.unhealthy} warnings=${summary.warnings} ` +
          `overdue=${summary.overdue} execution_healthy=${executionHealthy} dead_cadence=${deadCadence} unproven=${unproven}`,
      );
      for (const expectation of hosted.report.expectations.filter((entry) => !entry.ok || entry.check.status === "warn")) {
        const status = expectation.ok ? "warn" : "fail";
        console.log(
          `${status}  ${expectation.loop.name}  ${expectation.failure?.classification ?? "unknown"}  ${expectation.failure?.fingerprint ?? "-"}`,
        );
      }
      for (const expectation of hosted.report.expectations.filter((entry) => entry.overdue)) {
        console.log(
          `overdue  ${expectation.loop.name}  scheduled slot ${expectation.overdue!.nextRunAt} unclaimed for ${humanDuration(expectation.overdue!.byMs)}`,
        );
      }
      printUnchecked(hosted.unchecked);
    }
    if (!hosted.report.ok) process.exitCode = 1;
  } finally {
    await store.close();
  }
}

/** `loops doctor` against the hosted control plane; each check states its scope. */
async function hostedDoctor(): Promise<void> {
  const store = getStore();
  try {
    const hosted = await buildHostedDoctorReport(store);
    if (isJson()) console.log(JSON.stringify(hosted, null, 2));
    else {
      console.log(`backend  hosted control plane ${hosted.backend.apiUrl ?? "(url unavailable)"} (transport=${hosted.backend.transport})`);
      for (const check of hosted.report.checks) {
        const marker = check.status === "ok" ? "ok" : check.status === "warn" ? "warn" : "fail";
        console.log(
          `${marker.padEnd(4)} ${(check.scope ?? "-").padEnd(14)} ${check.id.padEnd(22)} ${check.message}${check.detail ? ` (${check.detail})` : ""}`,
        );
      }
      printUnchecked(hosted.unchecked);
    }
    if (!hosted.report.ok) process.exitCode = 1;
  } finally {
    await store.close();
  }
}

function printStorageConnectionReport(report: StorageConnectionReport, opts: { json?: boolean } = {}): void {
  if (isJson() || opts.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(storageConnectionReportLine(report));
    for (const warning of report.warnings) console.log(`warn ${warning}`);
  }
}

function statusCommand() {
  return (opts: { json?: boolean } = {}) => {
    printStorageConnectionReport(buildStorageConnectionReport(resolveRuntimeConfig()), opts);
  };
}

function printCreatedLoop(loop: ReturnType<Store["createLoop"]>, human: string, preflight?: unknown): void {
  if (preflight !== undefined) print({ loop: publicLoop(loop), preflight }, human);
  else print(publicLoop(loop), human);
}

function publicWorkflowBody(body: CreateWorkflowInput): Record<string, unknown> {
  const workflow = workflowSpecForPreflight(body, "render");
  return {
    name: workflow.name,
    description: workflow.description,
    steps: workflow.steps.map((step) => ({
      ...step,
      target: {
        ...step.target,
        ...("prompt" in step.target ? { prompt: redact(step.target.prompt) } : {}),
        ...("env" in step.target && step.target.env ? { env: "[redacted]" } : {}),
      },
    })),
    goal: workflow.goal,
  };
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
  // Command targets use the secret-safe descriptor (bounded + scrubbed for
  // shell targets) so the default loop description never embeds raw command
  // text or credential values into the durable store.
  if (target.type === "command") return `runs command ${publicCommandDescriptor(target)}`;
  if (target.type === "agent") return `runs ${target.provider} agent${target.cwd ? ` in ${target.cwd}` : ""}`;
  return `runs workflow ${target.workflowId}`;
}

function defaultLoopDescription(name: string, schedule: ScheduleSpec, target: LoopTarget): string {
  return [
    `Why: keep ${name} running as a Loops scheduled automation.`,
    `How: ${targetLabel(target)} on cadence ${scheduleLabel(schedule)}.`,
    "Outcome: record each run, status, retries, and evidence in Loops for operator review.",
  ].join(" ");
}

type LoopCreateOptions = Record<string, string | string[] | boolean | undefined>;

function baseCreateInput(name: string, opts: LoopCreateOptions, target: LoopTarget): CreateLoopInput {
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
    labels: normalizeLoopLabels(Array.isArray(opts.label) ? opts.label : typeof opts.label === "string" ? [opts.label] : undefined),
    schedule,
    target,
    goal: goalFromOpts(opts),
    machine: typeof opts.machine === "string" ? resolveLoopMachine(opts.machine) : undefined,
    ...policy,
    expiresAt: typeof opts.expiresAt === "string" ? new Date(opts.expiresAt).toISOString() : undefined,
    expiresAfterRuns: positiveInteger(
      typeof opts.expiresAfterRuns === "string" ? opts.expiresAfterRuns : undefined,
      "--expires-after-runs",
    ),
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
    .option("--expires-after-runs <n>", "expire the loop after this many consecutive successful runs")
    .option("-d, --description <text>", "description");
}

function addLabelOptions(command: Command): Command {
  return command.option("--label <label>", "loop label; repeatable or comma-separated", collectValues, [] as string[]);
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

function goalFromOpts(opts: LoopCreateOptions) {
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

function allowlistFromOpts(opts: { allowTool?: string[]; allowCommand?: string[]; safetyReason?: string }): AgentAllowlistSpec | undefined {
  const tools = (opts.allowTool ?? []).flatMap((entry) => splitList(entry) ?? []);
  const commands = (opts.allowCommand ?? []).flatMap((entry) => splitList(entry) ?? []);
  const safetyReason = opts.safetyReason?.trim();
  if (!tools.length && !commands.length && !safetyReason) return undefined;
  return {
    tools: tools.length ? tools : undefined,
    commands: commands.length ? commands : undefined,
    enforcement: "metadata_only",
    safetyReason: safetyReason || undefined,
  };
}

function runtimePreflightFromOpts(opts: { preflightEachRun?: boolean }): { beforeRun: true } | undefined {
  return opts.preflightEachRun ? { beforeRun: true } : undefined;
}

function parseKeyValueList(values: string[] | undefined, flag: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const value of values ?? []) {
    const index = value.indexOf("=");
    if (index <= 0) throw new ValidationError(`invalid ${flag} value, expected key=value: ${value}`);
    parsed[value.slice(0, index)] = value.slice(index + 1);
  }
  return parsed;
}

function parseVars(values: string[] | undefined): Record<string, string> {
  return parseKeyValueList(values, "--var");
}

/** Environment variables for a command/agent target's run; undefined (not `{}`) when none were passed, so the stored target omits the field like every other optional target property. */
function envFromOpts(values: string[] | undefined): Record<string, string> | undefined {
  const env = parseKeyValueList(values, "--env");
  return Object.keys(env).length ? env : undefined;
}

function parseJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`failed to read JSON file ${file}: ${reason}`);
  }
}

function parseReceiptFile(file: string): WriteRunReceiptInput {
  const raw = file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
  try {
    return JSON.parse(raw) as WriteRunReceiptInput;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`failed to read receipt JSON from ${file}: ${reason}`);
  }
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

function writeManifestFile(file: string | undefined, manifest: unknown): void {
  if (!file) return;
  if (manifest === undefined) throw new ValidationError("command did not produce a manifest");
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

/** Snapshot the database through lib/backup (VACUUM INTO, 1h per-reason debounce, keep 3). */
function backupLoopsDatabase(reason: string): string | undefined {
  return backupDatabase({ reason, keep: 3 }).path;
}

const create = program.command("create").description("create loops");

addGoalOptions(
  addAccountOptions(
    addMachineOptions(
      addLabelOptions(addScheduleOptions(
      create
        .command("command <name>")
        .description("create a deterministic shell command loop")
        .requiredOption("--cmd <command>", "command string to execute")
        .option("--cwd <dir>", "working directory")
        .option("--timeout <duration>", "run timeout; use none/unlimited for no timeout")
        .option("--no-shell", "execute without a shell")
        .option("--preflight-each-run", "check target executables/accounts before every scheduled run")
        .option("--preflight", "check target executables/accounts before storing the loop"),
      )),
    ),
  ),
).action(runAction(async (name, opts) => {
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
  await withStore(async (store) => {
    const loop = await store.createLoop(input);
    printCreatedLoop(loop, `created loop ${loop.id} (${loop.name}) next=${loop.nextRunAt}`, preflight);
  });
}));

addGoalOptions(
  addAccountOptions(
    addMachineOptions(
      addLabelOptions(addScheduleOptions(
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
        .option("--env <key=value>", "environment variable for the run; may be repeated", collectValues, [] as string[])
        .option("--add-dir <dir>", "additional writable directory for provider sandboxes; may be repeated or comma-separated", collectValues, [] as string[])
        .option("--timeout <duration>", "run timeout; use none/unlimited for no timeout")
        .option("--permission-mode <mode>", "provider permission mode: default, plan, auto, or bypass")
        .option("--sandbox <mode>", "provider sandbox: codewith/codex use read-only/workspace-write/danger-full-access; cursor uses enabled/disabled")
        .option("--allow-tool <name>", "advisory per-session tool allowlist metadata; may be repeated or comma-separated", collectValues, [] as string[])
        .option("--allow-command <name>", "advisory per-session command allowlist metadata; may be repeated or comma-separated", collectValues, [] as string[])
        .option("--safety-reason <reason>", "auditable reason for advisory restrictions or relaxed sandbox access")
        .option("--manual-break-glass", "confirm explicit operator break-glass approval for a relaxed sandbox")
        .option("--automated", "declare this as a scheduled/durable automated lane (e.g. a deploy chain) so relaxed access does not require manual break-glass")
        .option("--config-isolation <mode>", "safe or none", "safe")
        .option("--preflight-each-run", "check provider/account readiness before every scheduled run")
        .option("--preflight", "check target executables/accounts before storing the loop"),
      )),
    ),
  ),
).action(runAction(async (name, opts) => {
  const provider = opts.provider as AgentProvider;
  if (!["claude", "cursor", "codewith", "aicopilot", "opencode", "codex"].includes(provider)) {
    throw new ValidationError("unsupported provider");
  }
  if (!["safe", "none"].includes(opts.configIsolation)) {
    throw new ValidationError("--config-isolation must be safe or none");
  }
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
    env: envFromOpts(opts.env),
    addDirs: listFromRepeatedOpts(opts.addDir),
    timeoutMs: timeoutDuration(opts.timeout, "--timeout"),
    configIsolation: opts.configIsolation,
    permissionMode: permissionModeFromOpts(opts, provider),
    sandbox: sandboxFromOpts(opts, provider),
    manualBreakGlass: Boolean(opts.manualBreakGlass) || undefined,
    automated: Boolean(opts.automated) || undefined,
    allowlist: allowlistFromOpts(opts),
    account: accountFromOpts(opts),
    preflight: runtimePreflightFromOpts(opts),
  }, { name, type: "agent", provider }, { baseDir: process.cwd() });
  const input = baseCreateInput(name, opts, target);
  const preflight = opts.preflight
    ? preflightLoopTarget(input.target as Exclude<LoopTarget, { type: "workflow" }>, { name, type: "agent", provider }, { loopName: name }, { machine: input.machine })
    : undefined;
  await withStore(async (store) => {
    const loop = await store.createLoop(input);
    printCreatedLoop(loop, `created loop ${loop.id} (${loop.name}) next=${loop.nextRunAt}`, preflight);
  });
}));

addGoalOptions(
  addMachineOptions(
    addLabelOptions(addScheduleOptions(
    create
      .command("workflow <name>")
      .description("schedule a stored workflow")
      .requiredOption("--workflow <idOrName>", "workflow id or name")
      .option("--timeout <duration>", "workflow run timeout; use none/unlimited for no workflow-level timeout")
      .option("--preflight-each-run", "check workflow steps before every scheduled run")
      .option("--preflight", "check workflow step executables/accounts before storing the loop"),
    )),
  ),
).action(runAction((name, opts) => withStore(async (store) => {
  const workflow = await store.requireWorkflow(opts.workflow);
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
  const loop = await store.createLoop(input);
  printCreatedLoop(loop, `created workflow loop ${loop.id} (${loop.name}) workflow=${workflow.name} next=${loop.nextRunAt}`, preflight);
})));

const workflows = program.command("workflows").alias("workflow").description("manage workflow specs and runs");

const templates = program.command("templates").alias("template").description("render and store reusable loop/workflow templates");

const routes = program.command("routes").alias("route").description("create, inspect, and drain workflow invocation/admission routes");

const events = program.command("events").description("(deprecated) Hasna event envelope aliases for 'routes create' and 'routes drain'");

const machines = program.command("machines").description("inspect OpenMachines topology for loop assignment");

const goal = program.command("goal").description("inspect goal runs");

program
  .command("status")
  .description("show the Loops storage backend and client connection")
  .option("--json", "print JSON")
  .action(runAction(statusCommand()));

program
  .command("export")
  .description("export a local Loops migration bundle")
  .option("--file <path>", "write bundle JSON to this path (required unless --dry-run)")
  .option("--dry-run", "preview the bundle without writing the file")
  .option("--no-runs", "omit loop run history from the bundle")
  .option("--allow-redacted", "write a redacted non-importable bundle when env/secrets must be removed")
  .option("--json", "print JSON")
  .action(runAction((opts) => {
    if (!opts.dryRun && !opts.file) {
      throw new ValidationError("--file <path> is required unless --dry-run is used");
    }
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
        file: opts.file ?? null,
        bundle: publicMigrationBundle(bundle),
      };
      if (isJson() || opts.json) console.log(JSON.stringify(output, null, 2));
      else {
        const target = opts.file ?? "(no file)";
        console.log(`${opts.dryRun ? "would export" : "exported"} ${target} workflows=${bundle.counts.workflows} loops=${bundle.counts.loops} runs=${bundle.counts.runs}`);
        for (const warning of bundle.warnings) console.log(`warn ${warning}`);
      }
    } finally {
      store.close();
    }
  }));

program
  .command("import <file>")
  .description("preview or apply a local Loops migration bundle")
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

function controlPlaneMigrationCommand(operation: "push" | "pull" | "migrate") {
  return runAction(async (opts: { apiUrl?: string; runs?: boolean; json?: boolean }) => {
    const store = new Store();
    try {
      const plan = await buildControlPlaneMigrationPlan(store, {
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

program
  .command("migrate")
  .description("preview local-to-control-plane migration actions")
  .option("--api-url <url>", "control-plane API URL")
  .option("--dry-run", "preview only; migrate does not apply remote changes yet")
  .option("--no-runs", "omit loop run history from the preview")
  .option("--json", "print JSON")
  .action(controlPlaneMigrationCommand("migrate"));

program
  .command("push")
  .description("preview (default) or apply an id-preserving local->control-plane backfill")
  .option("--api-url <url>", "control-plane API URL")
  .option("--apply", "apply the backfill via the control-plane /v1/import endpoint (default is preview)")
  .option("--replace", "update differing same-id remote rows; safe default may still archive/pause same-id definitions")
  .option("--dry-run", "preview only; equivalent to omitting --apply")
  .option("--no-runs", "omit loop run history")
  .option("--manifest-file <path>", "write a control-plane comparison/import manifest JSON file")
  .option("--json", "print JSON")
  .action(runAction(async (opts: { apiUrl?: string; apply?: boolean; replace?: boolean; dryRun?: boolean; runs?: boolean; manifestFile?: string; json?: boolean }) => {
    if (!opts.apply || opts.dryRun) {
      const store = new Store();
      try {
        const plan = await buildControlPlaneMigrationPlan(store, {
          operation: "push",
          apiUrl: opts.apiUrl,
          includeRuns: opts.runs,
          replace: opts.replace,
        });
        writeManifestFile(opts.manifestFile, plan.manifest);
        printMigrationPlan(plan, opts);
      } finally {
        store.close();
      }
      return;
    }
    const store = new Store();
    try {
      const result = await applyControlPlanePush(store, {
        apiUrl: opts.apiUrl,
        includeRuns: opts.runs,
        replace: opts.replace,
      });
      writeManifestFile(opts.manifestFile, result.manifest);
      if (isJson() || opts.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(
          `pushed workflows=${result.applied.workflows} loops=${result.applied.loops} runs=${result.applied.runs} ` +
            `(skipped running=${result.skipped.runningRuns} orphan-runs=${result.skipped.orphanRuns}, ${result.requests} requests) -> ${result.apiUrl}`,
        );
      }
    } finally {
      store.close();
    }
  }));

program
  .command("pull")
  .description("preview control-plane rows that would be pulled locally")
  .option("--api-url <url>", "control-plane API URL")
  .option("--dry-run", "preview only; pull does not apply local changes yet")
  .option("--no-runs", "omit loop run history from the preview")
  .option("--json", "print JSON")
  .action(controlPlaneMigrationCommand("pull"));

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
  .description("list Loops templates")
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

function createWorkflowFromTemplate(id: string, opts: { var?: string[]; source?: string; name?: string; preflight?: boolean }): Promise<void> {
  return withStore(async (store) => {
    let body = renderLoopTemplate(id, parseVars(opts.var), { source: templateSource(opts.source) });
    if (opts.name) body = { ...body, name: opts.name };
    const preflight = opts.preflight
      ? preflightStoredWorkflow(workflowSpecForPreflight(body, "creation-preflight"), { name: body.name, type: "workflow", template: id }, {})
      : undefined;
    const workflow = await store.createWorkflow(body);
    if (preflight !== undefined) print({ workflow: publicWorkflow(workflow), preflight }, `created workflow ${workflow.id} (${workflow.name}) steps=${workflow.steps.length}`);
    else print(publicWorkflow(workflow), `created workflow ${workflow.id} (${workflow.name}) steps=${workflow.steps.length}`);
  });
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
  .action(runAction((opts) => withStore(async (store) => {
    const items = await store.listWorkflowWorkItems({
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
  })));

routes
  .command("show <id>")
  .description("show one admission work item")
  .action(runAction((id) => withStore(async (store) => {
    const item = await store.getWorkflowWorkItem(id);
    if (!item) throw new Error(`route work item not found: ${id}`);
    const invocation = await store.getWorkflowInvocation(item.invocationId);
    const workflow = item.workflowId ? await store.getWorkflow(item.workflowId) : undefined;
    const loop = item.loopId ? await store.getLoop(item.loopId) : undefined;
    print(
      {
        item: publicWorkflowWorkItem(item),
        invocation: invocation ? publicWorkflowInvocation(invocation) : undefined,
        workflow: workflow ? publicWorkflow(workflow) : undefined,
        loop: loop ? publicLoop(loop) : undefined,
      },
      `${item.id} ${item.status} ${item.routeKey} ${item.subjectRef}`,
    );
  })));

routes
  .command("requeue <id>")
  .description("requeue a terminal admission work item for the next task/event delivery (resets the redispatch attempt count so the unwedge is durable; --keep-attempts preserves it)")
  .option("--reason <text>", "operator reason recorded on the work item")
  .option("--keep-attempts", "preserve the redispatch attempt count instead of resetting it (cautious path: the item may re-cap after one more terminal run)")
  .action(runAction((id, opts) => withStore(async (store) => {
    const reason = stringField(opts.reason);
    if (!reason) throw new ValidationError("routes requeue requires --reason <text>");
    const item = await store.requeueWorkflowWorkItem(id, { reason, resetAttempts: !opts.keepAttempts });
    print(
      publicWorkflowWorkItem(item),
      `requeued route work item ${item.id} (${item.routeKey}) - ${opts.keepAttempts ? "attempts preserved" : "attempts reset"}`,
    );
  })));

routes
  .command("invocations")
  .description("list workflow invocations")
  .option("--limit <n>", "maximum rows", "50")
  .action(runAction((opts) => withStore(async (store) => {
    const invocations = await store.listWorkflowInvocations({ limit: positiveInteger(opts.limit, "--limit") ?? 50 });
    if (isJson()) print(invocations.map(publicWorkflowInvocation));
    else {
      for (const invocation of invocations) {
        console.log(
          `${invocation.id} ${invocation.intent.padEnd(8)} ${invocation.sourceRef.kind}:${invocation.sourceRef.id ?? "-"} -> ${invocation.subjectRef.kind}:${invocation.subjectRef.id ?? invocation.subjectRef.path ?? "-"}`,
        );
      }
    }
  })));

const routePolicies = routes.command("policies").alias("presets").description("inspect named route drain policies");

routePolicies
  .command("list")
  .alias("ls")
  .description("list named route drain policies")
  .action(runAction(() => {
    const policies = listRoutePolicies();
    if (isJson()) {
      print(policies.map((policy) => ({
        id: policy.id,
        title: policy.title,
        routeKind: policy.routeKind,
        safety: policy.safety,
        aliases: policy.aliases,
        source: policy.source,
      })));
      return;
    }
    for (const policy of policies) {
      console.log(`${policy.id}\t${policy.safety}\t${policy.routeKind}\t${policy.title}`);
    }
  }));

routePolicies
  .command("show <id>")
  .description("show one named route drain policy")
  .action(runAction((id) => {
    const rendered = renderRoutePolicy(id);
    if (isJson()) print(rendered.policy);
    else {
      const policy = rendered.policy;
      console.log(`${policy.id} (${policy.safety})`);
      console.log(policy.title);
      console.log(policy.description);
      console.log(`source: ${policy.source}`);
      if (policy.aliases?.length) console.log(`aliases: ${policy.aliases.join(",")}`);
      if (policy.notes?.length) {
        for (const note of policy.notes) console.log(`note: ${note}`);
      }
    }
  }));

routePolicies
  .command("render <id>")
  .description("render a named route policy as explicit replayable route drain arguments")
  .action(runAction((id) => {
    const rendered = renderRoutePolicy(id);
    if (isJson()) print(rendered);
    else {
      console.log(rendered.command);
      if (rendered.schedule.every) console.log(`schedule: --every ${rendered.schedule.every}`);
      else if (rendered.schedule.cron) console.log(`schedule: --cron ${rendered.schedule.cron}`);
      else if (rendered.schedule.at) console.log(`schedule: --at ${rendered.schedule.at}`);
      else if (rendered.schedule.dynamic) console.log("schedule: --dynamic");
    }
  }));

routePolicies
  .command("validate [id]")
  .description("validate one named route policy, or all policies when id is omitted")
  .action(runAction((id) => {
    const rendered = id ? [validateRoutePolicy(id)] : listRoutePolicies().map((policy) => validateRoutePolicy(policy.id));
    const value = {
      ok: true,
      policies: rendered.map((entry) => ({
        id: entry.policy.id,
        safety: entry.policy.safety,
        routeKind: entry.policy.routeKind,
        explicitArgCount: entry.args.length,
      })),
    };
    print(value, `valid route policies: ${value.policies.map((policy) => policy.id).join(",")}`);
  }));

async function handleRouteEvent(kind: string, opts: TodosTaskRouteOptions): Promise<void> {
  // Route admission writes invocations, work items, and loops through the local
  // sqlite Store in one transaction and gates on this machine's live concurrency
  // (countRunningWorkflowStepsByAuthProfile). It has no hosted /v1 equivalent, so
  // when the client is flipped to the cloud API a real (non-dry-run) create would
  // silently write to the on-box island — the split-brain we forbid. A dry-run
  // preview never touches the store, so it stays available on every connection.
  if (!opts.dryRun) assertLocalOnlyCommand("routes create");
  const event = await readEventEnvelopeInput(opts);
  const result = routeEventByKind(kind, event, opts);
  print(result.value, result.human);
  // A skip because the source could not be reached is not a successful routing
  // decision. @hasna/events records a command delivery as successful purely on
  // `code === 0` (transports.js: `const success = code === 0`), so exiting 0 here
  // files a dropped event as delivered. Exiting non-zero files it as failed, which
  // is what makes the drop visible. It does NOT by itself cause a redelivery:
  // measured on this fleet, every task-routing channel has `retry: null` and the
  // policy default is `maxAttempts: 1`, so retry happens only where a channel
  // explicitly configures it. Same doctrine as the drain's `fatal` count.
  if (result.value.sourceUnavailable) {
    console.error(`route could not reach the task source; event not routed and recorded as a failed delivery (retried only if this channel configures retry): ${String(result.value.reason ?? "source unavailable")}`);
    process.exitCode = 1;
  }
}

function handleRouteDrain(kind: string, opts: TodosDrainOptions): void {
  // Draining a source queue admits work through the same local-only Store
  // transaction path as `routes create`, so it is a local-runtime command: fail
  // loudly rather than write the on-box island while flipped to the hosted API.
  assertLocalOnlyCommand("routes drain");
  if (kind !== "todos-task") throw new ValidationError("route drain currently supports kind todos-task");
  const expandedOpts = applyRoutePolicyToDrainOptions(opts, { requireExplicitSafety: true });
  const result = drainTodosTaskRoutes(expandedOpts);
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
  const expandedOpts = applyRoutePolicyToScheduleOptions(opts);
  todosTaskRouteTemplateId(expandedOpts);
  return withStore(async (store) => {
    const target: LoopTarget = {
      type: "command",
      command: "loops",
      args: ["--json", ...routeDrainArgs({ ...expandedOpts, compact: expandedOpts.compact ?? true })],
      timeoutMs: parseDuration("20m"),
      preflight: runtimePreflightFromOpts(expandedOpts),
    };
    const input = baseCreateInput(name, expandedOpts, target);
    const loop = await store.createLoop(input);
    printCreatedLoop(loop, `created route drain loop ${loop.id} (${loop.name}) next=${loop.nextRunAt}`);
  });
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

function showGoal(idOrName: string): Promise<void> {
  return withStore(async (store) => {
    const runtimeGoal = (await store.getGoal(idOrName)) ?? (await store.findGoalByLoop(idOrName)) ?? (await store.findGoalByRunId(idOrName));
    if (runtimeGoal) {
      const value = {
        goal: publicGoal(runtimeGoal),
        nodes: await store.listGoalPlanNodes(runtimeGoal.goalId),
        runs: (await store.listGoalRuns({ goalId: runtimeGoal.goalId })).map(publicGoalRun),
      };
      print(value, `${runtimeGoal.goalId} ${runtimeGoal.status} ${runtimeGoal.objective}`);
      return;
    }
    const loop = (await store.getLoop(idOrName)) ?? (await store.findLoopByName(idOrName));
    if (loop?.goal) {
      print({ config: loop.goal, loop: publicLoop(loop) }, `configured goal for loop ${loop.name}: ${loop.goal.objective}`);
      return;
    }
    const workflow = (await store.getWorkflow(idOrName)) ?? (await store.findWorkflowByName(idOrName));
    if (workflow?.goal) {
      print({ config: workflow.goal, workflow: publicWorkflow(workflow) }, `configured goal for workflow ${workflow.name}: ${workflow.goal.objective}`);
      return;
    }
    const run = await store.getRun(idOrName);
    if (run) {
      const loop = await store.getLoop(run.loopId);
      if (loop?.goal) {
        print(
          { config: loop.goal, loop: publicLoop(loop), run: publicRun(run) },
          `configured goal for loop ${loop.name}: ${loop.goal.objective}`,
        );
        return;
      }
      print(
        { run: publicRun(run), loop: loop ? publicLoop(loop) : undefined },
        `loop run ${run.id}: ${run.status} ${run.loopName}`,
      );
      return;
    }
    throw new Error(`goal not found: ${idOrName}`);
  });
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
      return createWorkflowFromTemplate(opts.template, opts);
    }
    if (!file) throw new ValidationError("workflows create requires a workflow JSON file or --template <id>");
    return withStore(async (store) => {
      const body = workflowBodyFromFile(file, opts.name, { file, type: "workflow" });
      const preflight = opts.preflight
        ? preflightStoredWorkflow(workflowSpecForPreflight(body, "creation-preflight"), { name: body.name, type: "workflow" }, {})
        : undefined;
      const workflow = await store.createWorkflow(body);
      if (preflight !== undefined) print({ workflow: publicWorkflow(workflow), preflight }, `created workflow ${workflow.id} (${workflow.name}) steps=${workflow.steps.length}`);
      else print(publicWorkflow(workflow), `created workflow ${workflow.id} (${workflow.name}) steps=${workflow.steps.length}`);
    });
  }));

workflows
  .command("list")
  .alias("ls")
  .description("list stored workflows")
  .option("--status <status>", "active, archived, or all", "active")
  .option("--all", "include active and archived workflows")
  .option("--limit <n>", "maximum rows to print; omitted means all matching workflows")
  .option("--offset <n>", "number of matching rows to skip before printing", "0")
  .action(runAction((opts) => withStore(async (store) => {
    const status = workflowStatusFromOpts(opts.status, opts.all);
    const limit = positiveInteger(opts.limit, "--limit");
    const offset = nonNegativeInteger(opts.offset, "--offset") ?? 0;
    const workflowsList = await store.listWorkflows({ status, limit, offset });
    const total = await store.countWorkflows({ status });
    if (isJson()) print(workflowsList.map(publicWorkflow));
    else {
      for (const workflow of workflowsList) {
        console.log(`${workflow.id}  ${workflow.status.padEnd(8)}  steps=${workflow.steps.length}  ${workflow.name}`);
      }
    }
    if (limit !== undefined || offset > 0) printWorkflowListWarning({ shown: workflowsList.length, total, status, offset, limit });
  })));

workflows.command("show <idOrName>").description("show one stored workflow spec").action(runAction((idOrName) => withStore(async (store) => {
  print(publicWorkflow(await store.requireWorkflow(idOrName)));
})));

workflows.command("inspect <runId>").description("show a workflow run with steps and events").action(runAction((runId) => withStore(async (store) => {
  const run = await store.requireWorkflowRun(runId);
  const steps = await store.listWorkflowStepRuns(run.id);
  const runEvents = await store.listWorkflowEvents(run.id);
  const publicEvents = runEvents.filter((event) => !isPrivateOperationEventType(event.eventType));
  const value = {
    workflowRun: publicWorkflowRun(run),
    steps: steps.map((step) => publicWorkflowStepRun(step)),
    events: publicEvents.map(publicWorkflowEvent),
  };
  if (isJson()) print(value);
  else {
    console.log(`${run.id}  ${run.status}  ${run.workflowName}`);
    for (const step of steps) {
      const publicStep = publicWorkflowStepRun(step);
      console.log(`  ${String(step.sequence).padStart(2, "0")}  ${step.status.padEnd(10)}  ${step.stepId}  ${publicStep.error ?? ""}`);
    }
    console.log(`  events=${publicEvents.length}`);
  }
})));

workflows
  .command("run <idOrName>")
  .description("execute a stored workflow once now")
  .option("--show-output", "show step stdout/stderr")
  .action(runAction(async (idOrName, opts) => {
    assertLocalOnlyCommand("workflows run");
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
  .action(runAction((idOrName, opts) => withStore(async (store) => {
    const workflow = idOrName ? await store.requireWorkflow(idOrName) : undefined;
    const runs = await store.listWorkflowRuns({ workflowId: workflow?.id, limit: positiveInteger(opts.limit, "--limit") ?? 50 });
    if (isJson()) print(runs.map(publicWorkflowRun));
    else {
      for (const run of runs) {
        console.log(`${run.id}  ${run.status.padEnd(10)}  ${run.workflowName}  started=${run.startedAt ?? "-"}`);
      }
    }
  })));

workflows
  .command("events <runId>")
  .description("list step/lifecycle events for a workflow run")
  .option("--limit <n>", "limit", "200")
  .action(runAction((runId, opts) => withStore(async (store) => {
    const runEvents = await store.listWorkflowEvents(runId, positiveInteger(opts.limit, "--limit") ?? 200);
    const publicEvents = runEvents.filter((event) => !isPrivateOperationEventType(event.eventType));
    if (isJson()) print(publicEvents.map(publicWorkflowEvent));
    else {
      for (const event of publicEvents) {
        console.log(`${String(event.sequence).padStart(3, "0")}  ${event.eventType.padEnd(14)}  ${event.stepId ?? "-"}  ${event.createdAt}`);
      }
    }
  })));

workflows
  .command("cancel <runId>")
  .description("mark a workflow run cancelled and cancel pending/running steps")
  .option("--reason <reason>", "cancellation reason", "cancelled by user")
  .action(runAction((runId, opts) => withStore(async (store) => {
    const run = await store.cancelWorkflowRun(runId, opts.reason);
    print(publicWorkflowRun(run), `${run.id} ${run.status}`);
  })));

workflows
  .command("recover <runId>")
  .description("reset interrupted running workflow steps to pending")
  .option("--reason <reason>", "recovery reason", "manual recovery")
  .action(runAction((runId, opts) => withStore(async (store) => {
    const result = await store.recoverWorkflowRun(runId, opts.reason);
    print(
      {
        workflowRun: publicWorkflowRun(result.run),
        recoveredSteps: result.recoveredSteps.map((step) => publicWorkflowStepRun(step)),
      },
      `${result.run.id} recovered=${result.recoveredSteps.length}`,
    );
  })));

workflows
  .command("migrate-agent-timeouts")
  .description("migrate workflow loops, or a direct agent loop selected with --loop, to a new agent timeout policy")
  .option("--loop <idOrName>", "migrate only one loop; required for direct agent loops")
  .option("--timeout <duration>", "agent timeout policy; use none/unlimited for no timeout", "none")
  .option("--apply", "create new workflow specs or update direct agent targets for eligible loops")
  .option("--archive-old", "archive old workflow specs after retargeting when no active loops still reference them")
  .action(runAction((opts) => {
    assertLocalOnlyCommand("workflows migrate-agent-timeouts");
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
    assertLocalOnlyCommand("workflows migrate-goal-wrappers");
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

workflows.command("archive <idOrName>").description("archive a workflow spec without deleting runs").action(runAction((idOrName) => withStore(async (store) => {
  const workflow = await store.archiveWorkflow(idOrName);
  print(publicWorkflow(workflow), `${workflow.id} ${workflow.status}`);
})));

program
  .command("list")
  .alias("ls")
  .description("list loops with schedule and next-run summaries")
  .option("--status <status>", "filter by status")
  .option("--label <label>", "require a label; repeatable or comma-separated", collectValues, [] as string[])
  .option("--archived", "show only archived loops")
  .option("--all", "include archived loops")
  .action(runAction(async (opts) => {
    if (opts.archived && opts.all) throw new ValidationError("use either --archived or --all, not both");
    const loops = await withStore((store) =>
      listAllLoops(store, {
        status: opts.status,
        labels: normalizeLoopLabels(opts.label),
        archived: opts.archived,
        includeArchived: opts.all,
      }),
    );
    if (isJson()) print(loops.map(publicLoop));
    else {
      for (const loop of loops) {
        const machine = loop.machine ? `  machine=${loop.machine.id}` : "";
        const archive = loop.archivedAt ? `  archived=${loop.archivedAt} from=${loop.archivedFromStatus ?? "-"}` : "";
        const labels = loop.labels?.length ? `  labels=${loop.labels.join(",")}` : "";
        console.log(`${loop.id}  ${loop.status.padEnd(7)}  cadence=${scheduleLabel(loop.schedule)}  next=${loop.nextRunAt ?? "-"}  ${loop.name}${labels}${machine}${archive}`);
      }
    }
  }));

program
  .command("ui")
  .description("open a live table of active loops")
  .option("--refresh <duration>", "refresh interval", "2s")
  .action(runAction(async (opts: { refresh?: string }) => {
    // The live table reads this machine's local sqlite runtime directly (active
    // loops, running runs, local counts via countRuns) on a refresh loop; it has
    // no hosted /v1 equivalent, so it would show the on-box island's rows while
    // flipped to the cloud API. Fail loudly instead of rendering the wrong store.
    assertLocalOnlyCommand("ui");
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error("Loops UI requires a TTY terminal.");
      console.error("Use `loops list`, `loops runs`, or `loops daemon status` non-interactively.");
      process.exitCode = 1;
      return;
    }
    const refreshMs = Math.max(500, parseDuration(opts.refresh ?? "2s"));
    await runLoopsUiApp({ refreshMs });
  }));

program.command("show <idOrName>").description("show one loop by id or name").action(runAction((idOrName) => withStore(async (store) => {
  const loop = await store.requireLoop(idOrName);
  // BUG 96c837b0: the hosted control plane is scheduler-only; a loop executes
  // only when a loops-runner claims it. A machine-pinned loop with no runner
  // serving its machine sits due with zero runs and no error anywhere — make
  // that state loud on the surface the operator actually reads. Computed
  // client-side so it also works against a control plane that has not rolled
  // the API-side execution field.
  const hasRuns = (await store.listRuns({ loopId: loop.id, limit: 1 })).length > 0;
  const execution = classifyLoopExecutionStaleness(loop, { now: new Date(), hasRuns });
  if (execution.state === "unserved") {
    console.error(`UNSERVED: ${execution.reason}`);
  }
  print({ ...publicLoop(loop), execution });
})));

program
  .command("runs [idOrName]")
  .description("list recent runs, optionally for one loop")
  .option("--limit <n>", "limit", "50")
  .option("--offset <n>", "offset into the run list for pagination (default: 0)", "0")
  .option("--label <label>", "require the loop's current label; repeatable or comma-separated", collectValues, [] as string[])
  .option("--show-output", "show stdout/stderr")
  .action(runAction((idOrName, opts) => withStore(async (store) => {
    const limit = positiveInteger(opts.limit, "--limit") ?? 50;
    const offset = nonNegativeInteger(opts.offset, "--offset") ?? 0;
    let loop: Loop | undefined;
    if (idOrName) {
      try {
        loop = await store.requireLoop(idOrName);
      } catch (error) {
        if (error instanceof CodedError && error.code === "LOOP_NOT_FOUND" && await store.getRun(idOrName)) {
          throw new CodedError("LOOP_NOT_FOUND", `loop not found: ${idOrName}; argument looks like a run id; use 'loops goal show ${idOrName}' to inspect it`);
        }
        throw error;
      }
    }
    const runs = await store.listRuns({ loopId: loop?.id, labels: normalizeLoopLabels(opts.label), limit, offset });
    if (isJson()) {
      // Envelope so a truncated page (e.g. the hosted control plane clamping
      // a page at its 1000-row cap) is observable: the old bare array made
      // every 'no runs remain' claim a silent floor.
      // count must reflect the FILTERED population (same loopId/labels as the
      // list), so has_more turns false once the filtered set is exhausted
      // (LOO3-00143 P1). next_offset only advances while has_more is true.
      const count = await store.countRuns({ loopId: loop?.id, labels: normalizeLoopLabels(opts.label) });
      const hasMore = offset + runs.length < count;
      print({
        runs: runs.map((run) => publicRun(run, opts.showOutput)),
        count,
        has_more: hasMore,
        next_offset: hasMore ? offset + runs.length : offset,
      });
    } else {
      for (const run of runs) {
        console.log(
          `${run.id}  ${run.status.padEnd(10)}  attempt=${run.attempt}  slot=${run.scheduledFor}  ${run.loopName}`,
        );
        if (opts.showOutput) printTextOutput(run);
      }
    }
  })));

const labels = program.command("labels").description("set or edit persisted loop labels");

labels
  .command("set <idOrName> <labels...>")
  .description("replace all loop labels")
  .action(runAction((idOrName, values: string[]) => withStore(async (store) => {
    const loop = await store.requireUniqueLoop(idOrName);
    print(publicLoop(await store.updateLoop(loop.id, { labels: normalizeLoopLabels(values) })));
  })));

labels
  .command("add <idOrName> <labels...>")
  .description("add loop labels")
  .action(runAction((idOrName, values: string[]) => withStore(async (store) => {
    const loop = await store.requireUniqueLoop(idOrName);
    print(publicLoop(await store.updateLoop(loop.id, { labels: mergeLoopLabels(loop.labels, values) })));
  })));

labels
  .command("remove <idOrName> <labels...>")
  .description("remove loop labels")
  .action(runAction((idOrName, values: string[]) => withStore(async (store) => {
    const loop = await store.requireUniqueLoop(idOrName);
    print(publicLoop(await store.updateLoop(loop.id, { labels: removeLoopLabels(loop.labels, values) })));
  })));

labels
  .command("clear <idOrName>")
  .description("remove all loop labels")
  .action(runAction((idOrName) => withStore(async (store) => {
    const loop = await store.requireUniqueLoop(idOrName);
    print(publicLoop(await store.updateLoop(loop.id, { labels: [] })));
  })));

const receipts = program.command("receipts").description("read and write scheduler-neutral run receipts");

receipts
  .command("write")
  .description("write a bounded run receipt from JSON")
  .option("--file <path>", "receipt JSON file; use - for stdin", "-")
  .action(runAction((opts) => withStore(async (store) => {
    const receipt = await store.writeRunReceipt(parseReceiptFile(opts.file));
    print(publicRunReceipt(receipt), `receipt ${receipt.run_id} ${receipt.status} digest=${receipt.digest_id}`);
  })));

receipts
  .command("read <runId>")
  .description("read one run receipt by run id")
  .action(runAction((runId) => withStore(async (store) => {
    const receipt = await store.getRunReceipt(runId);
    if (!receipt) throw new ValidationError(`run receipt not found: ${runId}`);
    print(publicRunReceipt(receipt), `receipt ${receipt.run_id} ${receipt.status} digest=${receipt.digest_id}`);
  })));

receipts
  .command("list")
  .description("list run receipts")
  .option("--loop-id <id>", "filter by loop_id")
  .option("--repo <repo>", "filter by repo")
  .option("--task-id <id>", "filter by task id")
  .option("--knowledge-id <id>", "filter by knowledge id")
  .option("--status <status>", "filter by status")
  .option("--limit <n>", "limit", "50")
  .action(runAction((opts) => withStore(async (store) => {
    const values = await store.listRunReceipts({
      loopId: opts.loopId,
      repo: opts.repo,
      taskId: opts.taskId,
      knowledgeId: opts.knowledgeId,
      status: opts.status,
      limit: positiveInteger(opts.limit, "--limit") ?? 50,
    });
    if (isJson()) print(values.map(publicRunReceipt));
    else {
      for (const receipt of values) {
        console.log(`${receipt.run_id}  ${receipt.status.padEnd(10)}  loop=${receipt.loop_id}  repo=${receipt.repo}`);
      }
    }
  })));

program
  .command("expectations [idOrName]")
  .description("evaluate deterministic loop expectations without mutating external task systems")
  .option("--limit <n>", "maximum loops to inspect when no loop is specified", "200")
  .action(runAction((idOrName, opts) => {
    assertLocalOnlyCommand("expectations");
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
  .action(runAction(async () => {
    if (isCloudStore()) return await hostedHealth();
    const store = new Store();
    try {
      const report = buildHealthReport(store);
      if (isJson()) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(
          `loops=${report.summary.loops} healthy=${report.summary.healthy} unhealthy=${report.summary.unhealthy} warnings=${report.summary.warnings}`,
        );
        for (const expectation of report.expectations.filter((entry) => !entry.ok || entry.check.status === "warn")) {
          const status = expectation.ok ? "warn" : "fail";
          console.log(
            `${status}  ${expectation.loop.name}  ${expectation.failure?.classification ?? "unknown"}  ${expectation.failure?.fingerprint ?? "-"}`,
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
  .description("scan Loops health, write bounded reports, and optionally upsert deduped todos findings")
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
    if (isCloudStore()) {
      if (opts.startDaemon || opts.daemon || opts.doctor || opts.upsertTodos) {
        throw new CloudUnsupportedError(
          "hosted health scan only supports read-only hosted checks; daemon, doctor, and todos routing remain machine-local",
        );
      }
      const store = getStore();
      try {
        const hosted = await buildHostedHealthScan(store, {
          includeStatuses: parseLoopStatuses(opts.include, "--include"),
          limit: positiveInteger(opts.limit, "--limit") ?? 200,
          maxFindings: nonNegativeInteger(opts.maxFindings, "--max-findings") ?? 100,
          latestRun: opts.latestRun !== false,
          staleRunningMs: opts.staleRunningAfter
            ? positiveDuration(opts.staleRunningAfter, "--stale-running-after")
            : undefined,
        });
        const scan = writeHealthScanReports(hosted.scan, { reportDir: opts.reportDir ?? opts.evidenceDir });
        const output = { ...scan, backend: hosted.backend, unchecked: hosted.unchecked };
        if (opts.json || isJson()) console.log(JSON.stringify(compactHealthScanOutput(output), null, 2));
        else {
          console.log(
            `health_scan backend=hosted status=${scan.status} loops=${scan.counts.loops} findings=${scan.counts.findings} ` +
              `reported=${scan.counts.reportedFindings} truncated=${scan.counts.truncatedFindings} ` +
              `latest=${scan.counts.latestRunFindings} stale_running=${scan.counts.staleRunning}`,
          );
          for (const finding of scan.findings) {
            console.log(`${finding.severity} ${finding.kind} ${finding.fingerprint} ${finding.loop?.name ?? ""} ${finding.message}`);
          }
          printUnchecked(hosted.unchecked);
        }
        if (scan.status !== "ok") process.exitCode = scan.status === "critical" ? 2 : 1;
      } finally {
        await store.close();
      }
      return;
    }
    assertLocalOnlyCommand("health scan");
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
            description: "Deduped Loops health scan findings for daemon, doctor, preflight, latest-run, and stale-running issues.",
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
    assertLocalOnlyCommand("health route-tasks");
    const store = new Store();
    try {
      const report = buildHealthReport(store, { limit: positiveInteger(opts.limit, "--limit") ?? 200, includeInactive: Boolean(opts.includeInactive) });
      const failures = report.expectations.filter((entry) => !entry.ok && entry.recommendedTask);
      const result = upsertRouteTasks({
        project: opts.project,
        taskList: {
          slug: opts.taskList,
          name: "Loop Error Self Heal",
          description: "Deduped Loops health expectation failures routed by loops health route-tasks.",
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

const hygiene = program.command("hygiene").description("deterministic Loops hygiene checks and safe repairs");

hygiene
  .command("names")
  .description("check or apply canonical machine-/repo-prefixed loop names")
  .option("--apply", "rename loops in-place")
  .option("--include-stopped", "include stopped loops")
  .option("--include-inactive", "include stopped, expired, and archived loops")
  .option("--limit <n>", "maximum loops to inspect", "1000")
  .action(runAction((opts) => {
    assertLocalOnlyCommand("hygiene names");
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
    assertLocalOnlyCommand("hygiene duplicates");
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
    assertLocalOnlyCommand("hygiene scripts");
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
    assertLocalOnlyCommand("hygiene route-tasks");
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
          name: "Loops Hygiene",
          description: "Deduped Loops hygiene findings routed by loops hygiene route-tasks.",
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

hygiene
  .command("stuck")
  .description(
    "check or reclaim loop runs stuck 'running' with an expired lease and no live process (7cf8d8c1: an unreapable orphan row whose loop cursor never advances through recovery)",
  )
  .option("--apply", "abandon reclaimable runs and immediately advance their loop's nextRunAt")
  .option("--limit <n>", "maximum runs to reclaim in one pass", "100")
  .action(runAction(async (opts) => {
    const limit = positiveInteger(opts.limit, "--limit") ?? 100;
    if (isCloudStore()) {
      await withStore(async (store) => {
        const report = await store.listStuckRunCandidates({ limit });
        const reconciliation = opts.apply && report.candidates.length > 0
          ? await store.reconcileStuckRunCandidates(report.candidates)
          : undefined;
        const output = { ...report, applied: Boolean(opts.apply), reconciliation };
        if (isJson()) console.log(JSON.stringify(output, null, 2));
        else {
          console.log(
            `hygiene_stuck backend=hosted state=${report.state} candidates=${report.candidates.length} ` +
              `truncated=${report.truncated} applied=${Boolean(opts.apply)}`,
          );
          for (const candidate of report.candidates) {
            const outcome = reconciliation?.outcomes.find((entry) => entry.runId === candidate.runId);
            console.log(
              `${outcome?.outcome ?? "would-reconcile"} run=${candidate.runId} loop=${candidate.loopId} ` +
                `snapshot=${candidate.snapshotId}${outcome?.reason ? ` reason=${outcome.reason}` : ""}`,
            );
          }
        }
        if (!opts.apply && report.state === "stuck") process.exitCode = 1;
        if (reconciliation?.outcomes.some((outcome) =>
          outcome.outcome === "conflict" || outcome.outcome === "operation_reconciliation_required"
        )) process.exitCode = 1;
      });
      return;
    }
    const store = new Store();
    try {
      const preview = buildStuckRunReport(store, { apply: false, limit });
      // A live-looking-but-deferred run still gets mutated on apply (its
      // lease_expires_at and defer_count both advance toward the grace
      // ceiling), so back up whenever apply will touch ANY expired-lease row,
      // not only when something is immediately reclaimable.
      const backupPath =
        opts.apply && preview.stuck + preview.liveDeferred > 0 ? backupLoopsDatabase("stuck-run-hygiene") : undefined;
      const report = opts.apply ? buildStuckRunReport(store, { apply: true, limit }) : preview;
      const output = backupPath ? { ...report, backupPath } : report;
      if (isJson()) console.log(JSON.stringify(output, null, 2));
      else {
        console.log(
          `hygiene_stuck checked=${report.checked} stuck=${report.stuck} live_deferred=${report.liveDeferred} applied=${report.applied}`,
        );
        if (backupPath) console.log(`backup=${backupPath}`);
        for (const entry of report.entries) {
          const verb = entry.reclaimed ? "reclaimed" : entry.deferredReason === "live_process" ? "live-deferred" : "would-reclaim";
          console.log(`${verb} run=${entry.runId} loop=${entry.loopId} (${entry.loopName}) lease_expired=${entry.leaseExpiresAt ?? ""} pid=${entry.pid ?? ""}`);
        }
        for (const loopId of report.advancedLoopIds) console.log(`advanced loop=${loopId}`);
      }
      if (!report.ok && !report.applied) process.exitCode = 1;
    } finally {
      store.close();
    }
  }));

interface LoopMutationCliOptions {
  operationId?: string;
  stepId?: string;
  expectedRevision?: string;
  approvedPlanDigest?: string;
  manifestDigest?: string;
  descriptorRef?: string;
  descriptorDigest?: string;
  dryRun?: boolean;
}

function addLoopMutationOptions(command: Command): Command {
  return command
    .option("--operation-id <id>", "caller-stable mutation operation id")
    .option("--step-id <id>", "caller-stable mutation step id")
    .option("--expected-revision <revision>", "exact loop updatedAt revision read before mutation")
    .option("--approved-plan-digest <sha256>", "approved plan sha256 digest")
    .option("--manifest-digest <sha256>", "immutable mutation manifest sha256 digest")
    .option("--descriptor-ref <ref>", "opaque owner-only target descriptor reference")
    .option("--descriptor-digest <sha256>", "target descriptor sha256 digest")
    .option("--dry-run", "validate and receipt the mutation without changing the loop");
}

addLoopMutationOptions(program.command("pause <id>").description("pause a loop by full id using the hosted mutation contract"))
  .action(runAction((id, opts) => updateStatus(id, "paused", opts)));
addLoopMutationOptions(program.command("resume <id>").description("resume a loop by full id using the hosted mutation contract"))
  .action(runAction((id, opts) => updateStatus(id, "active", opts)));
addLoopMutationOptions(program.command("stop <id>").description("stop a loop by full id using the hosted mutation contract"))
  .action(runAction((id, opts) => updateStatus(id, "stopped", opts)));

program
  .command("rename <idOrName> <newName>")
  .description("rename a loop without changing its id, schedule, runs, or history")
  .action(runAction((idOrName, newName) => withStore(async (store) => {
    const loop = await store.requireUniqueLoop(idOrName);
    const oldName = loop.name;
    const trimmed = String(newName).trim();
    if (!trimmed) throw new ValidationError("loop name must not be empty");

    const existing = await store.findLoopByName(trimmed);
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

    // Backups protect the on-box sqlite file; there is nothing local to snapshot
    // when the rename is routed to the hosted API.
    const backupPath = store.transport === "file" ? backupLoopsDatabase("rename") : undefined;
    const renamed = await store.renameLoop(loop.id, trimmed);
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
  })));

program
  .command("set-max-attempts <idOrName> <attempts>")
  .description("change a loop's retry budget in place, without losing its id, schedule, runs, or history")
  .action(runAction((idOrName, attempts) => withStore(async (store) => {
    // requireUniqueLoop so an ambiguous name errors instead of mutating the
    // newest same-named loop -- the same guard rename and pause/resume use.
    const loop = await store.requireUniqueLoop(idOrName);
    const previous = loop.maxAttempts;
    const next = positiveInteger(String(attempts), "<attempts>");
    if (next === undefined) throw new ValidationError("attempts must be an integer >= 1");

    if (next === previous) {
      print(
        { changed: false, id: loop.id, maxAttempts: previous, loop: publicLoop(loop) },
        `${loop.id} unchanged (maxAttempts=${previous})`,
      );
      return;
    }

    // Backups protect the on-box sqlite file; there is nothing local to snapshot
    // when the update is routed to the hosted API.
    const backupPath = store.transport === "file" ? backupLoopsDatabase("set-max-attempts") : undefined;
    const updated = await store.updateLoop(loop.id, { maxAttempts: next });
    print(
      {
        changed: true,
        id: updated.id,
        previousMaxAttempts: previous,
        maxAttempts: updated.maxAttempts,
        backupPath,
        loop: publicLoop(updated),
      },
      `${updated.id} maxAttempts ${previous} -> ${updated.maxAttempts}\nbackup=${backupPath ?? "skipped (recent backup exists)"}`,
    );
  })));

program
  .command("set-lease <idOrName> <duration>")
  .description("change a loop's run lease in place, without losing its id, schedule, runs, or history")
  .action(runAction((idOrName, duration) => withStore(async (store) => {
    // requireUniqueLoop so an ambiguous name errors instead of mutating the
    // newest same-named loop -- the same guard rename and pause/resume use.
    const loop = await store.requireUniqueLoop(idOrName);
    const previous = loop.leaseMs;
    const next = positiveDuration(duration, "<duration>");
    if (next === undefined) throw new ValidationError("duration must be greater than zero");

    if (next === previous) {
      print(
        { changed: false, id: loop.id, leaseMs: previous, loop: publicLoop(loop) },
        `${loop.id} unchanged (leaseMs=${previous})`,
      );
      return;
    }

    // Backups protect the on-box sqlite file; there is nothing local to snapshot
    // when the update is routed to the hosted API.
    const backupPath = store.transport === "file" ? backupLoopsDatabase("set-lease") : undefined;
    const updated = await store.updateLoop(loop.id, { leaseMs: next });
    print(
      {
        changed: true,
        id: updated.id,
        previousLeaseMs: previous,
        leaseMs: updated.leaseMs,
        backupPath,
        loop: publicLoop(updated),
      },
      `${updated.id} leaseMs ${previous} -> ${updated.leaseMs}\nbackup=${backupPath ?? "skipped (recent backup exists)"}`,
    );
  })));

function updateStatus(
  idOrName: string,
  status: "paused" | "active" | "stopped",
  opts: LoopMutationCliOptions = {},
): Promise<void> {
  return withStore(async (store) => {
    const supplied = [
      opts.operationId,
      opts.stepId,
      opts.expectedRevision,
      opts.approvedPlanDigest,
      opts.manifestDigest,
      opts.descriptorRef,
      opts.descriptorDigest,
    ];
    const usesContract = supplied.some((value) => value !== undefined) || opts.dryRun === true;
    if (store.transport === "api" || usesContract) {
      if (supplied.some((value) => typeof value !== "string" || value.trim() === "")) {
        throw new ValidationError(
          "hosted pause/resume/stop require --operation-id, --step-id, --expected-revision, " +
          "--approved-plan-digest, --manifest-digest, --descriptor-ref, and --descriptor-digest",
        );
      }
      const envelope: LoopMutationEnvelope = {
        schema: "openloops.loop_mutation.v1",
        operationId: opts.operationId!,
        stepId: opts.stepId!,
        targetId: idOrName,
        action: status === "active" ? "resume" : status === "paused" ? "pause" : "stop",
        expectedRevision: opts.expectedRevision!,
        approvedPlanDigest: opts.approvedPlanDigest!,
        manifestDigest: opts.manifestDigest!,
        descriptorRef: opts.descriptorRef!,
        descriptorDigest: opts.descriptorDigest!,
        ...(opts.dryRun ? { dryRun: true } : {}),
      };
      const mutation = await store.mutateLoop(envelope);
      print(
        {
          ...mutation,
          loop: publicLoop(mutation.loop),
        },
        `${mutation.loop.id} ${mutation.terminal.state} (${mutation.loop.status}) replayed=${mutation.replayed}`,
      );
      return;
    }
    // requireUniqueLoop so an ambiguous name errors instead of mutating the
    // newest same-named loop.
    const loop = await store.requireUniqueLoop(idOrName);
    if (loop.archivedAt) throw new Error(`loop is archived; run 'loops unarchive ${idOrName}' first`);
    let nextRunAt = loop.nextRunAt;
    if (status === "stopped") {
      nextRunAt = undefined;
    } else if (status === "active" && !loop.nextRunAt) {
      // Resuming a stopped loop leaves next_run_at NULL, so dueLoops (which
      // requires next_run_at IS NOT NULL) would never pick it up: the loop is
      // "active" but permanently dormant. Recompute the next slot from now.
      // initialNextRun (not computeNextAfter) so schedule.type "once" binds
      // schedule.at instead of undefined, converging with the contract
      // mutateLoop resume path.
      const now = new Date();
      nextRunAt = initialNextRun(loop.schedule, now);
    }
    const updated = await store.updateLoop(loop.id, { status, nextRunAt });
    print(publicLoop(updated), `${updated.id} ${updated.status}`);
  });
}

program
  .command("remove <idOrName>")
  .alias("rm")
  .description("delete a loop and its run history")
  .action(runAction((idOrName) => withStore(async (store) => {
    // requireUniqueLoop so an ambiguous name errors instead of deleting the
    // newest same-named loop.
    const loop = await store.requireUniqueLoop(idOrName);
    const removed = await store.deleteLoop(loop.id);
    print({ removed }, removed ? "removed" : "not removed");
  })));

program.command("archive <idOrName>").description("archive a loop without deleting history").action(runAction((idOrName) => withStore(async (store) => {
  const loop = await store.archiveLoop(idOrName);
  print(publicLoop(loop), `${loop.id} archived`);
})));

program.command("unarchive <idOrName>").alias("restore").description("restore an archived loop").action(runAction((idOrName) => withStore(async (store) => {
  const loop = await store.unarchiveLoop(idOrName);
  print(publicLoop(loop), `${loop.id} ${loop.status}`);
})));

program
  .command("run-now <idOrName>")
  .description("claim and execute one loop run immediately")
  .option("--show-output", "show stdout/stderr")
  .action(runAction(async (idOrName, opts) => {
    if (isCloudStore()) {
      // Hosted route (hosted run-now): schedule the loop due now on the control
      // plane. A bound loops-runner claims it on its next poll and executes it,
      // reporting through the runner endpoints. The client NEVER runs the loop
      // target while connected to the hosted API — there is no local island to
      // fall back to, so the schedule mutation is the entire operation.
      return await withStore(async (store) => {
        const loop = await store.requireUniqueLoop(idOrName);
        if (loop.archivedAt) throw new Error(`loop is archived; run 'loops unarchive ${idOrName}' before running it`);
        const result = await store.runNow(loop.id);
        const value = {
          loop: publicLoop(result.loop),
          scheduledFor: result.scheduledFor,
          runNow: { source: "hosted", advancesLoop: false },
        };
        print(value, `${result.loop.id} scheduled now source=hosted (a bound loops-runner executes it)`);
      });
    }
    const store = new Store();
    try {
      const loop = store.requireUniqueLoop(idOrName);
      if (loop.archivedAt) throw new Error(`loop is archived; run 'loops unarchive ${idOrName}' before running it`);
      const result = await runLoopNow({
        store,
        idOrName: loop.id,
        runnerId: `manual:${process.pid}`,
      });
      const run = result.run;
      const value = { ...publicRun(run, opts.showOutput), runNow: { source: result.source, advancesLoop: result.advancedLoop } };
      print(value, `${run.id} ${run.status} source=${result.source} slot=${run.scheduledFor}`);
      if (!isJson() && opts.showOutput) printTextOutput(run);
      if (run.status !== "succeeded" && run.status !== "skipped") process.exitCode = 1;
    } finally {
      store.close();
    }
  }));

program.command("tick").description("run one scheduler tick").action(runAction(async () => {
  assertLocalOnlyCommand("tick");
  const store = new Store();
  try {
    const result = await tick({ store, runnerId: `manual-tick:${process.pid}` });
    print(result, `completed=${result.completed.length} skipped=${result.skipped.length} recovered=${result.recovered.length}`);
  } finally {
    store.close();
  }
}));

program.command("doctor").description("check Loops runtime dependencies and state").action(runAction(async () => {
  if (isCloudStore()) return await hostedDoctor();
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
    // gc rotates the on-box sqlite backups + WAL and prunes local temp files, so
    // it is a local-runtime maintenance command. (History pruning of the shared
    // store is available via the hosted control plane, not this on-box command.)
    assertLocalOnlyCommand("gc");
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
  .action(runAction(async (opts) => {
    assertLocalOnlyCommand("daemon run");
    return runDaemon({ intervalMs: opts.intervalMs });
  }));

daemon.command("start").description("start the daemon in the background").action(runAction(async () => {
  assertLocalOnlyCommand("daemon start");
  const result = await startDaemon({ cliEntry: process.argv[1] ?? "loops" });
  print(result, result.alreadyRunning ? `already running pid=${result.pid}` : result.started ? `started pid=${result.pid}` : "failed to start");
}));

daemon.command("stop").description("stop the background daemon").action(runAction(async () => {
  assertLocalOnlyCommand("daemon stop");
  const result = await stopDaemon();
  print(result, result.stopped ? `stopped pid=${result.pid}` : "not running");
}));

daemon.command("status").description("show daemon lease/heartbeat status").action(runAction(() => {
  assertLocalOnlyCommand("daemon status");
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
    assertLocalOnlyCommand("daemon install");
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
    assertLocalOnlyCommand("daemon logs");
    const path = daemonLogPath();
    if (!existsSync(path)) {
      if (isJson()) console.log(JSON.stringify({ path, lines: [] }, null, 2));
      else console.log("");
      return;
    }
    // Validate n so a bad value ('abc') errors instead of NaN -> slice(0) dumping
    // the whole log. --tail wins when both are supplied.
    const count = positiveInteger(opts.tail ?? opts.lines, opts.tail !== undefined ? "--tail" : "--lines") ?? 80;
    // Strip SGR color codes: older daemon builds logged through Bun's
    // `console.error`, which wraps lines in red ANSI, so persisted logs carry
    // color pollution that would otherwise leak into both outputs.
    const lines = readFileSync(path, "utf8").trimEnd().split("\n").slice(-count).map(stripAnsi);
    if (isJson()) console.log(JSON.stringify({ path, lines }, null, 2));
    else console.log(lines.join("\n"));
  }));

await program.parseAsync(process.argv);
