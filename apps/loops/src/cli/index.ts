#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Command } from "commander";
import type {
  AccountRef,
  AgentAllowlistSpec,
  AgentPermissionMode,
  AgentProvider,
  AgentSandbox,
  CatchUpPolicy,
  CreateLoopInput,
  CreateWorkflowInput,
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
  publicWorkflowRun,
  publicWorkflowStepRun,
  redact,
  textOutputBlocks,
} from "../lib/format.js";
import { parseDuration } from "../lib/schedule.js";
import { Store } from "../lib/store.js";
import { executeWorkflow, preflightWorkflow } from "../lib/workflow-runner.js";
import { preflightTarget } from "../lib/executor.js";
import { advanceLoop, executeClaimedRun, manualRunScheduledFor, manualRunSource, shouldAdvanceManualRun, tick } from "../lib/scheduler.js";
import { daemonStatus, stopDaemon } from "../daemon/control.js";
import { runDaemon, startDaemon } from "../daemon/daemon.js";
import { enableStartup, installStartup } from "../daemon/install.js";
import { workflowBodyFromJson } from "../lib/workflow-spec.js";
import { normalizeGoalSpec } from "../lib/workflow-spec.js";
import { runDoctor } from "../lib/doctor.js";
import { buildHealthReport, expectationForLoop } from "../lib/health.js";
import {
  buildDuplicateOverlapReport,
  buildNameHygieneReport,
  buildScriptInventoryReport,
} from "../lib/hygiene.js";
import { listOpenMachines, resolveLoopMachine } from "../lib/machines.js";
import { packageVersion } from "../lib/version.js";
import {
  getLoopTemplate,
  listLoopTemplates,
  renderEventWorkerVerifierWorkflow,
  renderLoopTemplate,
  renderTodosTaskWorkerVerifierWorkflow,
} from "../lib/templates.js";
import type { EventEnvelope } from "@hasna/events";

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

function printCreatedLoop(loop: ReturnType<Store["createLoop"]>, human: string, preflight?: unknown): void {
  if (preflight !== undefined) print({ loop: publicLoop(loop), preflight }, human);
  else print(publicLoop(loop), human);
}

function preflightFailed(error: unknown, context: Record<string, unknown>): never {
  if (!isJson()) throw error;
  const message = error instanceof Error ? error.message : String(error);
  print({
    ok: false,
    created: false,
    preflight: {
      ok: false,
      error: redact(message, 320),
    },
    ...context,
  });
  process.exit(1);
}

function preflightLoopTarget(
  target: Exclude<LoopTarget, { type: "workflow" }>,
  context: Record<string, unknown>,
  metadata: Parameters<typeof preflightTarget>[1],
  opts: Parameters<typeof preflightTarget>[2],
): ReturnType<typeof preflightTarget> {
  try {
    return preflightTarget(target, metadata, opts);
  } catch (error) {
    preflightFailed(error, context);
  }
}

function preflightStoredWorkflow(
  workflow: Parameters<typeof preflightWorkflow>[0],
  context: Record<string, unknown>,
  opts: Parameters<typeof preflightWorkflow>[1],
): ReturnType<typeof preflightWorkflow> {
  try {
    return preflightWorkflow(workflow, opts);
  } catch (error) {
    preflightFailed(error, context);
  }
}

function workflowSpecForPreflight(body: CreateWorkflowInput, id = "validation"): WorkflowSpec {
  const now = new Date().toISOString();
  return {
    id,
    name: body.name,
    description: body.description,
    version: body.version ?? 1,
    status: "active",
    goal: body.goal,
    steps: body.steps,
    createdAt: now,
    updatedAt: now,
  };
}

function printTextOutput(value: { stdout?: string; stderr?: string }): void {
  for (const line of textOutputBlocks(value, { indent: "  " })) console.log(line);
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
  return {
    name,
    description: typeof opts.description === "string" ? opts.description : undefined,
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

function accountFromOpts(opts: {
  account?: string;
  accountTool?: string;
  accountPool?: string;
  workerAccount?: string;
  verifierAccount?: string;
}): AccountRef | undefined {
  if (!opts.account && opts.accountTool && !opts.accountPool && !opts.workerAccount && !opts.verifierAccount) {
    throw new Error("--account-tool requires --account, --account-pool, --worker-account, or --verifier-account");
  }
  return opts.account ? { profile: opts.account, tool: opts.accountTool } : undefined;
}

function splitList(value: string | undefined): string[] | undefined {
  const values = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values?.length ? values : undefined;
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

function accountPoolFromOpts(opts: { accountPool?: string; accountTool?: string }): AccountRef[] | undefined {
  return splitList(opts.accountPool)?.map((profile) => ({ profile, tool: opts.accountTool }));
}

function roleAccountFromOpts(opts: { accountTool?: string }, profile: string | undefined): AccountRef | undefined {
  return profile ? { profile, tool: opts.accountTool } : undefined;
}

function runtimePreflightFromOpts(opts: { preflightEachRun?: boolean }): { beforeRun: true } | undefined {
  return opts.preflightEachRun ? { beforeRun: true } : undefined;
}

function parseVars(values: string[] | undefined): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const value of values ?? []) {
    const index = value.indexOf("=");
    if (index <= 0) throw new Error(`invalid --var value, expected key=value: ${value}`);
    vars[value.slice(0, index)] = value.slice(index + 1);
  }
  return vars;
}

function collectValues(value: string, previous: string[] = []): string[] {
  previous.push(value);
  return previous;
}

function defaultLoopsProject(): string {
  return process.env.LOOPS_TASK_PROJECT || process.env.LOOPS_DATA_DIR || `${process.env.HOME ?? "/home/hasna"}/.hasna/loops`;
}

function runLocalCommand(command: string, args: string[], opts: { input?: string; timeoutMs?: number } = {}) {
  const result = spawnSync(command, args, {
    input: opts.input,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 30_000,
    maxBuffer: 8 * 1024 * 1024,
    env: process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? String(result.error.message || result.error) : "",
  };
}

function ensureTodosTaskList(project: string, slug: string, name: string, description: string): string {
  runLocalCommand("todos", ["--project", project, "task-lists", "--add", name, "--slug", slug, "-d", description]);
  const list = runLocalCommand("todos", ["--project", project, "--json", "task-lists"]);
  if (!list.ok) throw new Error(list.stderr || list.error || "failed to list todos task lists");
  const values = JSON.parse(list.stdout || "[]") as Array<{ id: string; slug: string }>;
  const found = values.find((entry) => entry.slug === slug);
  if (!found) throw new Error(`todos task list not found after ensure: ${slug}`);
  return found.id;
}

function backupLoopsDatabase(reason: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
  const backupDir = join(dataDir(), "backups");
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backupPath = join(backupDir, `loops.db.bak-${reason}-${stamp}`);
  const db = new Database(dbPath(), { readonly: true });
  try {
    writeFileSync(backupPath, db.serialize(), { mode: 0o600 });
  } finally {
    db.close();
  }
  return backupPath;
}

function stableHash(parts: unknown[]): string {
  return createHash("sha256").update(parts.map((part) => JSON.stringify(part)).join("\n")).digest("hex").slice(0, 16);
}

interface RouteCursor {
  lastFingerprint?: string;
  updatedAt?: string;
}

interface RouteSelection<T> {
  selected: T[];
  cursor: {
    key: string;
    total: number;
    maxActions: number;
    previousFingerprint?: string;
    startIndex: number;
    lastFingerprint?: string;
  };
}

function routeCursorsPath(): string {
  return join(dataDir(), "route-cursors.json");
}

function readRouteCursors(): Record<string, RouteCursor> {
  const path = routeCursorsPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeRouteCursor(key: string, lastFingerprint: string | undefined): void {
  if (!lastFingerprint) return;
  const cursors = readRouteCursors();
  cursors[key] = { lastFingerprint, updatedAt: new Date().toISOString() };
  writeFileSync(routeCursorsPath(), JSON.stringify(cursors, null, 2), { mode: 0o600 });
}

function selectRouteItems<T>(items: T[], maxActions: number, cursorKey: string, fingerprintOf: (item: T) => string): RouteSelection<T> {
  const total = items.length;
  const boundedMax = Math.max(0, Math.floor(Number.isFinite(maxActions) ? maxActions : 0));
  if (total === 0 || boundedMax === 0) {
    return { selected: [], cursor: { key: cursorKey, total, maxActions: boundedMax, startIndex: 0 } };
  }
  const cursors = readRouteCursors();
  const previousFingerprint = cursors[cursorKey]?.lastFingerprint;
  const previousIndex = previousFingerprint ? items.findIndex((item) => fingerprintOf(item) === previousFingerprint) : -1;
  const startIndex = previousIndex >= 0 ? (previousIndex + 1) % total : 0;
  const selected: T[] = [];
  const count = Math.min(boundedMax, total);
  for (let index = 0; index < count; index += 1) selected.push(items[(startIndex + index) % total]);
  return {
    selected,
    cursor: {
      key: cursorKey,
      total,
      maxActions: boundedMax,
      previousFingerprint,
      startIndex,
      lastFingerprint: selected.length ? fingerprintOf(selected[selected.length - 1]) : undefined,
    },
  };
}

function eventData(event: EventEnvelope): Record<string, unknown> {
  const data = event.data;
  if (data && typeof data === "object" && !Array.isArray(data)) return data;
  return {};
}

function eventMetadata(event: EventEnvelope): Record<string, unknown> {
  const metadata = (event as { metadata?: unknown }).metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) return metadata as Record<string, unknown>;
  return {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function slugSegment(value: string, fallback = "event"): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || fallback;
}

function stableSuffix(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function taskEventField(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const direct = stringField(data[key]);
    if (direct) return direct;
  }
  const task = data.task;
  if (task && typeof task === "object" && !Array.isArray(task)) {
    for (const key of keys) {
      const direct = stringField((task as Record<string, unknown>)[key]);
      if (direct) return direct;
    }
  }
  const payload = data.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    for (const key of keys) {
      const direct = stringField((payload as Record<string, unknown>)[key]);
      if (direct) return direct;
    }
  }
  return undefined;
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function nestedObject(input: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  return objectField(input[key]);
}

function taskEventRecords(data: Record<string, unknown>, metadata: Record<string, unknown>): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [data];
  const dataTask = nestedObject(data, "task");
  if (dataTask) records.push(dataTask);
  const dataPayload = nestedObject(data, "payload");
  if (dataPayload) {
    records.push(dataPayload);
    const payloadTask = nestedObject(dataPayload, "task");
    if (payloadTask) records.push(payloadTask);
  }
  const dataMetadata = nestedObject(data, "metadata");
  if (dataMetadata) records.push(dataMetadata);
  records.push(metadata);
  const metadataTask = nestedObject(metadata, "task");
  if (metadataTask) records.push(metadataTask);
  const metadataAutomation = nestedObject(metadata, "automation");
  if (metadataAutomation) records.push(metadataAutomation);
  return records;
}

function booleanLike(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1;
}

function hasTruthyField(records: Record<string, unknown>[], keys: string[]): boolean {
  return records.some((record) => keys.some((key) => booleanLike(record[key])));
}

function automationRecords(data: Record<string, unknown>, metadata: Record<string, unknown>): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const dataAutomation = nestedObject(data, "automation");
  if (dataAutomation) records.push(dataAutomation);
  const dataTask = nestedObject(data, "task");
  const dataTaskAutomation = dataTask ? nestedObject(dataTask, "automation") : undefined;
  if (dataTaskAutomation) records.push(dataTaskAutomation);
  const dataPayload = nestedObject(data, "payload");
  const payloadAutomation = dataPayload ? nestedObject(dataPayload, "automation") : undefined;
  if (payloadAutomation) records.push(payloadAutomation);
  const payloadTask = dataPayload ? nestedObject(dataPayload, "task") : undefined;
  const payloadTaskAutomation = payloadTask ? nestedObject(payloadTask, "automation") : undefined;
  if (payloadTaskAutomation) records.push(payloadTaskAutomation);
  const dataMetadata = nestedObject(data, "metadata");
  const dataMetadataAutomation = dataMetadata ? nestedObject(dataMetadata, "automation") : undefined;
  if (dataMetadataAutomation) records.push(dataMetadataAutomation);
  const metadataAutomation = nestedObject(metadata, "automation");
  if (metadataAutomation) records.push(metadataAutomation);
  const metadataTask = nestedObject(metadata, "task");
  const metadataTaskAutomation = metadataTask ? nestedObject(metadataTask, "automation") : undefined;
  if (metadataTaskAutomation) records.push(metadataTaskAutomation);
  return records;
}

function tagsFromValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function taskEventTags(records: Record<string, unknown>[]): string[] {
  const tags = new Set<string>();
  for (const record of records) {
    for (const tag of tagsFromValue(record.tags ?? record.task_tags ?? record.taskTags)) tags.add(tag);
  }
  return [...tags];
}

function taskRouteEligibility(data: Record<string, unknown>, metadata: Record<string, unknown>): { eligible: boolean; reason?: string; tags: string[] } {
  const records = taskEventRecords(data, metadata);
  const tags = taskEventTags(records);
  const hasRouteOptIn =
    tags.includes("auto:route") ||
    hasTruthyField(records, ["route_enabled", "routeEnabled", "automation_allowed", "automationAllowed"]) ||
    hasTruthyField(automationRecords(data, metadata), ["allowed"]);
  if (!hasRouteOptIn) return { eligible: false, reason: "missing explicit route opt-in", tags };

  const status = taskEventField(data, ["status", "task_status", "taskStatus"])?.toLowerCase();
  if (status && ["blocked", "completed", "done", "cancelled", "canceled", "failed", "archived"].includes(status)) {
    return { eligible: false, reason: `task status is not routable: ${status}`, tags };
  }

  const disallowedTags = tags.filter((tag) => ["no-auto", "manual", "manual-required", "approval-required"].includes(tag));
  if (disallowedTags.length) return { eligible: false, reason: `task has disallowed tag: ${disallowedTags[0]}`, tags };

  if (hasTruthyField(records, [
    "no_auto",
    "noAuto",
    "manual",
    "manual_required",
    "manualRequired",
    "requires_approval",
    "requiresApproval",
    "approval_required",
    "approvalRequired",
  ])) {
    return { eligible: false, reason: "task metadata requires manual or approval-gated handling", tags };
  }

  return { eligible: true, tags };
}

async function readEventEnvelopeFromStdin(): Promise<EventEnvelope> {
  const raw = process.env.HASNA_EVENT_JSON || (await Bun.stdin.text());
  const event = JSON.parse(raw);
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("event JSON must be an object");
  if (!stringField(event.id)) throw new Error("event.id is required");
  if (!stringField(event.type)) throw new Error("event.type is required");
  if (!stringField(event.source)) throw new Error("event.source is required");
  return event as EventEnvelope;
}

function providerAuthProfileFromOpts(opts: { authProfile?: string }, provider: AgentProvider): string | undefined {
  if (!opts.authProfile) return undefined;
  if (provider !== "codewith") throw new Error("--auth-profile is currently supported only for --provider codewith");
  return opts.authProfile;
}

function sandboxFromOpts(opts: { sandbox?: string }, provider: AgentProvider): AgentSandbox | undefined {
  if (!opts.sandbox) return undefined;
  const codexLike = ["read-only", "workspace-write", "danger-full-access"];
  const cursorLike = ["enabled", "disabled"];
  if (["codewith", "codex"].includes(provider)) {
    if (!codexLike.includes(opts.sandbox)) {
      throw new Error("--sandbox must be read-only, workspace-write, or danger-full-access for codewith/codex");
    }
    return opts.sandbox as AgentSandbox;
  }
  if (provider === "cursor") {
    if (!cursorLike.includes(opts.sandbox)) {
      throw new Error("--sandbox must be enabled or disabled for cursor");
    }
    return opts.sandbox as AgentSandbox;
  }
  throw new Error("--sandbox is currently supported only for --provider codewith, codex, or cursor");
}

function permissionModeFromOpts(opts: { permissionMode?: string }, provider: AgentProvider): AgentPermissionMode | undefined {
  if (!opts.permissionMode) return undefined;
  const mode = opts.permissionMode;
  if (!["default", "plan", "auto", "bypass"].includes(mode)) {
    throw new Error("--permission-mode must be default, plan, auto, or bypass");
  }
  if (mode === "plan" && !["claude", "cursor"].includes(provider)) {
    throw new Error("--permission-mode plan is currently supported only for claude or cursor");
  }
  if (mode === "auto" && provider !== "claude") {
    throw new Error("--permission-mode auto is currently supported only for claude");
  }
  return mode as AgentPermissionMode;
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
        .option("--timeout <duration>", "run timeout")
        .option("--no-shell", "execute without a shell")
        .option("--preflight-each-run", "check target executables/accounts before every scheduled run")
        .option("--preflight", "check target executables/accounts before storing the loop"),
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
});

addGoalOptions(
  addAccountOptions(
    addMachineOptions(
      addScheduleOptions(
      create
        .command("agent <name>")
        .description("create a headless coding-agent loop")
        .requiredOption("--provider <provider>", "claude, cursor, codewith, aicopilot, opencode, or codex")
        .requiredOption("--prompt <prompt>", "agent prompt")
        .option("--cwd <dir>", "working directory")
        .option("--model <model>", "model")
        .option("--variant <variant>", "provider-specific model variant or reasoning effort")
        .option("--agent <agent>", "provider-specific agent")
        .option("--auth-profile <profile>", "provider-native auth profile; currently supported for codewith")
        .option("--timeout <duration>", "run timeout")
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
).action((name, opts) => {
  const provider = opts.provider as AgentProvider;
  if (!["claude", "cursor", "codewith", "aicopilot", "opencode", "codex"].includes(provider)) {
    throw new Error("unsupported provider");
  }
  if (!["safe", "none"].includes(opts.configIsolation)) {
    throw new Error("--config-isolation must be safe or none");
  }
  const store = new Store();
  try {
    const target: LoopTarget = {
      type: "agent",
      provider,
      prompt: opts.prompt,
      cwd: opts.cwd,
      model: opts.model,
      variant: opts.variant,
      agent: opts.agent,
      authProfile: providerAuthProfileFromOpts(opts, provider),
      timeoutMs: opts.timeout ? parseDuration(opts.timeout) : undefined,
      configIsolation: opts.configIsolation,
      permissionMode: permissionModeFromOpts(opts, provider),
      sandbox: sandboxFromOpts(opts, provider),
      allowlist: allowlistFromOpts(opts),
      account: accountFromOpts(opts),
      preflight: runtimePreflightFromOpts(opts),
    };
    const input = baseCreateInput(name, opts, target);
    const preflight = opts.preflight
      ? preflightLoopTarget(input.target as Exclude<LoopTarget, { type: "workflow" }>, { name, type: "agent", provider }, { loopName: name }, { machine: input.machine })
      : undefined;
    const loop = store.createLoop(input);
    printCreatedLoop(loop, `created loop ${loop.id} (${loop.name}) next=${loop.nextRunAt}`, preflight);
  } finally {
    store.close();
  }
});

addGoalOptions(
  addMachineOptions(
    addScheduleOptions(
    create
      .command("workflow <name>")
      .description("schedule a stored workflow")
      .requiredOption("--workflow <idOrName>", "workflow id or name")
      .option("--preflight-each-run", "check workflow steps before every scheduled run")
      .option("--preflight", "check workflow step executables/accounts before storing the loop"),
    ),
  ),
).action((name, opts) => {
  const store = new Store();
  try {
    const workflow = store.requireWorkflow(opts.workflow);
    const target: LoopTarget = {
      type: "workflow",
      workflowId: workflow.id,
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
});

const workflows = program.command("workflows").alias("workflow").description("manage workflow specs and runs");

const templates = program.command("templates").alias("template").description("render and store reusable loop/workflow templates");

const events = program.command("events").description("handle Hasna event envelopes from stdin or command transport");

const machines = program.command("machines").description("inspect OpenMachines topology for loop assignment");

const goal = program.command("goal").description("inspect goal runs");

templates
  .command("list")
  .alias("ls")
  .description("list built-in OpenLoops templates")
  .action(() => {
    const values = listLoopTemplates();
    if (isJson()) print(values);
    else {
      for (const template of values) {
        console.log(`${template.id}\t${template.kind}\t${template.description}`);
      }
    }
  });

templates.command("show <id>").description("show a built-in template").action((id) => {
  const template = getLoopTemplate(id);
  if (!template) throw new Error(`template not found: ${id}`);
  print(template, `${template.id} ${template.kind}`);
});

templates
  .command("render <id>")
  .description("render a template as workflow JSON")
  .option("--var <key=value>", "template variable; may be repeated", collectValues, [] as string[])
  .action((id, opts) => {
    const workflow = renderLoopTemplate(id, parseVars(opts.var));
    print(workflow, JSON.stringify(workflow, null, 2));
  });

templates
  .command("create-workflow <id>")
  .description("render and store a template as a workflow")
  .option("--var <key=value>", "template variable; may be repeated", collectValues, [] as string[])
  .action((id, opts) => {
    const store = new Store();
    try {
      const body = renderLoopTemplate(id, parseVars(opts.var));
      const workflow = store.createWorkflow(body);
      print(publicWorkflow(workflow), `created workflow ${workflow.id} (${workflow.name}) steps=${workflow.steps.length}`);
    } finally {
      store.close();
    }
  });

const eventsHandle = events.command("handle").description("handle a Hasna event envelope");

eventsHandle
  .command("todos-task")
  .description("create a one-shot worker/verifier workflow loop for a todos task event")
  .option("--provider <provider>", "agent provider", "codewith")
  .option("--auth-profile <profile>", "provider-native auth profile; currently supported for codewith")
  .option("--auth-profile-pool <profiles>", "comma-separated provider-native auth profile pool")
  .option("--worker-auth-profile <profile>", "provider-native auth profile for worker step")
  .option("--verifier-auth-profile <profile>", "provider-native auth profile for verifier step")
  .option("--account <profile>", "OpenAccounts profile name")
  .option("--account-pool <profiles>", "comma-separated OpenAccounts profile pool")
  .option("--worker-account <profile>", "OpenAccounts profile for worker step")
  .option("--verifier-account <profile>", "OpenAccounts profile for verifier step")
  .option("--account-tool <tool>", "OpenAccounts tool id")
  .option("--model <model>", "provider model")
  .option("--variant <variant>", "provider-specific model variant or reasoning effort")
  .option("--agent <agent>", "provider-specific agent")
  .option("--permission-mode <mode>", "provider permission mode: default, plan, auto, or bypass", "bypass")
  .option("--sandbox <mode>", "provider sandbox")
  .option("--project-path <path>", "fallback project/repo working directory")
  .option("--name-prefix <prefix>", "workflow/loop name prefix", "event:todos-task")
  .option("--preflight", "check generated workflow steps before storing the workflow loop")
  .option("--dry-run", "print the workflow and loop input without storing anything")
  .action(async (opts) => {
    const event = await readEventEnvelopeFromStdin();
    const data = eventData(event);
    const metadata = eventMetadata(event);
    const taskId = taskEventField(data, ["id", "task_id", "taskId"]);
    if (!taskId) throw new Error("todos task event is missing task id in data.id, data.task_id, data.task.id, or data.payload.id");
    const eligibility = taskRouteEligibility(data, metadata);
    if (!eligibility.eligible) {
      print(
        { skipped: true, reason: eligibility.reason, event, taskId, eligibility },
        `skipped task ${taskId}: ${eligibility.reason}`,
      );
      return;
    }
    const taskTitle = taskEventField(data, ["title", "task_title", "taskTitle"]);
    const taskDescription = taskEventField(data, ["description", "body"]);
    const dataProjectPath = taskEventField(data, ["working_dir", "workingDir", "project_path", "projectPath", "cwd"]);
    const metadataProjectPath = taskEventField(metadata, [
      "working_dir",
      "workingDir",
      "project_path",
      "projectPath",
      "project_canonical_path",
      "cwd",
    ]);
    const projectPath =
      opts.projectPath ??
      dataProjectPath ??
      metadataProjectPath ??
      process.cwd();
    const idempotencyKey = `todos-task:${taskId}:${event.type}`;
    const provider = opts.provider as AgentProvider;
    if (!["claude", "cursor", "codewith", "aicopilot", "opencode", "codex"].includes(provider)) throw new Error("unsupported provider");
    const permissionMode = permissionModeFromOpts({ permissionMode: opts.permissionMode }, provider);
    const sandbox = sandboxFromOpts({ sandbox: opts.sandbox }, provider);
    const authProfile = providerAuthProfileFromOpts({ authProfile: opts.authProfile }, provider);
    const workflowBody = renderTodosTaskWorkerVerifierWorkflow({
      taskId,
      taskTitle,
      taskDescription,
      projectPath,
      provider,
      authProfile,
      authProfilePool: splitList(opts.authProfilePool),
      workerAuthProfile: opts.workerAuthProfile,
      verifierAuthProfile: opts.verifierAuthProfile,
      account: accountFromOpts(opts),
      accountPool: accountPoolFromOpts(opts),
      workerAccount: roleAccountFromOpts(opts, opts.workerAccount),
      verifierAccount: roleAccountFromOpts(opts, opts.verifierAccount),
      model: opts.model,
      variant: opts.variant,
      agent: opts.agent,
      permissionMode,
      sandbox,
      eventId: event.id,
      eventType: event.type,
    });
    const idempotencySuffix = stableSuffix(idempotencyKey);
    workflowBody.name = `${opts.namePrefix}:${taskId.slice(0, 8)}:${idempotencySuffix}:workflow`;
    workflowBody.description =
      `Task-triggered worker/verifier workflow for ${taskTitle ?? taskId} from ${event.source}/${event.type}; ` +
      `idempotency=${idempotencyKey}; event=${event.id}`;
    const loopName = `${opts.namePrefix}:${taskId.slice(0, 8)}:${idempotencySuffix}:run`;
    const legacyLoopName = `${opts.namePrefix}:${taskId.slice(0, 8)}:${event.id.slice(0, 8)}:run`;
    const loopInput = {
      name: loopName,
      description: `Run ${workflowBody.name} once for task ${taskId}; idempotency=${idempotencyKey}; event=${event.id}`,
      schedule: { type: "once" as const, at: new Date(Date.now() + 1_000).toISOString() },
      target: { type: "workflow" as const, workflowId: "<created-workflow-id>" },
      overlap: "skip" as const,
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 90 * 60_000,
    };
    if (opts.dryRun) {
      const preflight = opts.preflight
        ? preflightStoredWorkflow(workflowSpecForPreflight(workflowBody, "event-preflight"), {
            name: workflowBody.name,
            type: "todos-task-event-workflow",
            event: event.id,
          }, {})
        : undefined;
      print({ deduped: false, idempotencyKey, event, workflow: workflowBody, loop: loopInput, preflight }, `dry-run ${loopName}`);
      return;
    }
    const store = new Store();
    try {
      const existingLoop = store.findLoopByName(loopName) ?? store.findLoopByName(legacyLoopName);
      if (existingLoop) {
        const existingWorkflow = existingLoop.target.type === "workflow" ? store.getWorkflow(existingLoop.target.workflowId) : undefined;
        print(
          {
            deduped: true,
            idempotencyKey,
            dedupedBy: existingLoop.name === loopName ? "idempotency" : "legacy-event-name",
            event,
            workflow: existingWorkflow ? publicWorkflow(existingWorkflow) : undefined,
            loop: publicLoop(existingLoop),
          },
          `deduped existing loop ${existingLoop.id} (${existingLoop.name}) for event=${event.id} idempotency=${idempotencyKey}`,
        );
        return;
      }
      const existingWorkflow = store.findWorkflowByName(workflowBody.name);
      const workflowPreflightSpec = existingWorkflow ?? workflowSpecForPreflight(workflowBody, "event-preflight");
      const preflight = opts.preflight
        ? preflightStoredWorkflow(workflowPreflightSpec, {
            name: workflowBody.name,
            type: "todos-task-event-workflow",
            event: event.id,
          }, {})
        : undefined;
      const workflow = existingWorkflow ?? store.createWorkflow(workflowBody);
      const loop = store.createLoop({
        ...loopInput,
        target: { type: "workflow", workflowId: workflow.id },
      });
      print(
        { deduped: false, idempotencyKey, event, workflow: publicWorkflow(workflow), loop: publicLoop(loop), preflight },
        `created ${loop.id} (${loop.name}) workflow=${workflow.name} event=${event.id} idempotency=${idempotencyKey}`,
      );
    } finally {
      store.close();
    }
  });

eventsHandle
  .command("generic")
  .description("create a one-shot worker/verifier workflow loop for any Hasna event")
  .option("--provider <provider>", "agent provider", "codewith")
  .option("--auth-profile <profile>", "provider-native auth profile; currently supported for codewith")
  .option("--auth-profile-pool <profiles>", "comma-separated provider-native auth profile pool")
  .option("--worker-auth-profile <profile>", "provider-native auth profile for worker step")
  .option("--verifier-auth-profile <profile>", "provider-native auth profile for verifier step")
  .option("--account <profile>", "OpenAccounts profile name")
  .option("--account-pool <profiles>", "comma-separated OpenAccounts profile pool")
  .option("--worker-account <profile>", "OpenAccounts profile for worker step")
  .option("--verifier-account <profile>", "OpenAccounts profile for verifier step")
  .option("--account-tool <tool>", "OpenAccounts tool id")
  .option("--model <model>", "provider model")
  .option("--variant <variant>", "provider-specific model variant or reasoning effort")
  .option("--agent <agent>", "provider-specific agent")
  .option("--permission-mode <mode>", "provider permission mode: default, plan, auto, or bypass", "bypass")
  .option("--sandbox <mode>", "provider sandbox")
  .option("--project-path <path>", "fallback project/repo working directory")
  .option("--name-prefix <prefix>", "workflow/loop name prefix", "event:generic")
  .option("--preflight", "check generated workflow steps before storing the workflow loop")
  .option("--dry-run", "print the workflow and loop input without storing anything")
  .action(async (opts) => {
    const event = await readEventEnvelopeFromStdin();
    const data = eventData(event);
    const projectPath =
      opts.projectPath ??
      taskEventField(data, ["working_dir", "workingDir", "project_path", "projectPath", "cwd", "repo_path", "repoPath"]) ??
      process.cwd();
    const provider = opts.provider as AgentProvider;
    if (!["claude", "cursor", "codewith", "aicopilot", "opencode", "codex"].includes(provider)) throw new Error("unsupported provider");
    const permissionMode = permissionModeFromOpts({ permissionMode: opts.permissionMode }, provider);
    const sandbox = sandboxFromOpts({ sandbox: opts.sandbox }, provider);
    const authProfile = providerAuthProfileFromOpts({ authProfile: opts.authProfile }, provider);
    const workflowBody = renderEventWorkerVerifierWorkflow({
      eventId: event.id,
      eventType: event.type,
      eventSource: event.source,
      eventSubject: stringField(event.subject),
      eventMessage: stringField(event.message),
      eventJson: JSON.stringify(event),
      projectPath,
      provider,
      authProfile,
      authProfilePool: splitList(opts.authProfilePool),
      workerAuthProfile: opts.workerAuthProfile,
      verifierAuthProfile: opts.verifierAuthProfile,
      account: accountFromOpts(opts),
      accountPool: accountPoolFromOpts(opts),
      workerAccount: roleAccountFromOpts(opts, opts.workerAccount),
      verifierAccount: roleAccountFromOpts(opts, opts.verifierAccount),
      model: opts.model,
      variant: opts.variant,
      agent: opts.agent,
      permissionMode,
      sandbox,
    });
    const eventSuffix = event.id.slice(0, 8);
    const source = slugSegment(event.source, "source");
    const type = slugSegment(event.type, "type");
    workflowBody.name = `${opts.namePrefix}:${source}:${type}:${eventSuffix}:workflow`;
    workflowBody.description = `Event-triggered worker/verifier workflow for ${event.source}/${event.type}`;
    const loopName = `${opts.namePrefix}:${source}:${type}:${eventSuffix}:run`;
    const loopInput = {
      name: loopName,
      description: `Run ${workflowBody.name} once for event ${event.id}`,
      schedule: { type: "once" as const, at: new Date(Date.now() + 1_000).toISOString() },
      target: { type: "workflow" as const, workflowId: "<created-workflow-id>" },
      overlap: "skip" as const,
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 90 * 60_000,
    };
    if (opts.dryRun) {
      const preflight = opts.preflight
        ? preflightStoredWorkflow(workflowSpecForPreflight(workflowBody, "event-preflight"), {
            name: workflowBody.name,
            type: "generic-event-workflow",
            event: event.id,
          }, {})
        : undefined;
      print({ event, workflow: workflowBody, loop: loopInput, preflight }, `dry-run ${loopName}`);
      return;
    }
    const store = new Store();
    try {
      const existingLoop = store.findLoopByName(loopName);
      if (existingLoop) {
        const existingWorkflow = existingLoop.target.type === "workflow" ? store.getWorkflow(existingLoop.target.workflowId) : undefined;
        print(
          { deduped: true, event, workflow: existingWorkflow ? publicWorkflow(existingWorkflow) : undefined, loop: publicLoop(existingLoop) },
          `deduped existing loop ${existingLoop.id} (${existingLoop.name})`,
        );
        return;
      }
      const existingWorkflow = store.findWorkflowByName(workflowBody.name);
      const workflowPreflightSpec = existingWorkflow ?? workflowSpecForPreflight(workflowBody, "event-preflight");
      const preflight = opts.preflight
        ? preflightStoredWorkflow(workflowPreflightSpec, {
            name: workflowBody.name,
            type: "generic-event-workflow",
            event: event.id,
          }, {})
        : undefined;
      const workflow = existingWorkflow ?? store.createWorkflow(workflowBody);
      const loop = store.createLoop({
        ...loopInput,
        target: { type: "workflow", workflowId: workflow.id },
      });
      print(
        { deduped: false, event, workflow: publicWorkflow(workflow), loop: publicLoop(loop), preflight },
        `created ${loop.id} (${loop.name}) workflow=${workflow.name}`,
      );
    } finally {
      store.close();
    }
  });

goal.command("show <idOrName>").description("show a goal or configured loop/workflow goal").action((idOrName) => {
  const store = new Store();
  try {
    const runtimeGoal = store.getGoal(idOrName) ?? store.findGoalByLoop(idOrName);
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
});

goal.command("status <runId>").description("show goal status for a goal, goal event, loop run, or workflow run").action((runId) => {
  const store = new Store();
  try {
    const runtimeGoal = store.findGoalByRunId(runId);
    if (!runtimeGoal) throw new Error(`goal run not found: ${runId}`);
    const value = {
      goal: publicGoal(runtimeGoal),
      nodes: store.listGoalPlanNodes(runtimeGoal.goalId),
      runs: store.listGoalRuns({ goalId: runtimeGoal.goalId }).map(publicGoalRun),
    };
    print(value, `${runtimeGoal.goalId} ${runtimeGoal.status} tokens=${runtimeGoal.tokensUsed}`);
  } finally {
    store.close();
  }
});

machines
  .command("list")
  .alias("ls")
  .description("list known machines")
  .action(() => {
    const values = listOpenMachines();
    if (isJson()) print(values);
    else {
      for (const machine of values) {
        const route = machine.local ? "local" : machine.route ?? "-";
        console.log(`${machine.id.padEnd(12)}  ${route.padEnd(10)}  workspace=${machine.workspacePath ?? "-"}  host=${machine.hostname ?? "-"}`);
      }
    }
  });

machines.command("show <id>").description("resolve a machine assignment").action((id) => {
  print(resolveLoopMachine(id));
});

workflows
  .command("validate <file>")
  .description("validate a workflow JSON file without storing or running it")
  .option("--name <name>", "override workflow name from the file")
  .option("--preflight", "also check account env and target executables")
  .action((file, opts) => {
    const body = workflowBodyFromJson(JSON.parse(readFileSync(file, "utf8")), opts.name);
    const workflow = workflowSpecForPreflight(body);
    const preflight = opts.preflight ? preflightWorkflow(workflow) : undefined;
    print({ valid: true, workflow: publicWorkflow(workflow), preflight }, `valid workflow ${workflow.name} steps=${workflow.steps.length}`);
  });

workflows
  .command("create <file>")
  .description("validate and store a workflow JSON file")
  .option("--name <name>", "override workflow name from the file")
  .option("--preflight", "also check account env and target executables before storing")
  .action((file, opts) => {
    const store = new Store();
    try {
      const body = workflowBodyFromJson(JSON.parse(readFileSync(file, "utf8")), opts.name);
      const preflight = opts.preflight
        ? preflightStoredWorkflow(workflowSpecForPreflight(body, "creation-preflight"), { name: body.name, type: "workflow" }, {})
        : undefined;
      const workflow = store.createWorkflow(body);
      if (preflight !== undefined) print({ workflow: publicWorkflow(workflow), preflight }, `created workflow ${workflow.id} (${workflow.name}) steps=${workflow.steps.length}`);
      else print(publicWorkflow(workflow), `created workflow ${workflow.id} (${workflow.name}) steps=${workflow.steps.length}`);
    } finally {
      store.close();
    }
  });

workflows
  .command("list")
  .alias("ls")
  .option("--status <status>", "active or archived", "active")
  .action((opts) => {
    const store = new Store();
    try {
      const workflowsList = store.listWorkflows({ status: opts.status });
      if (isJson()) print(workflowsList.map(publicWorkflow));
      else {
        for (const workflow of workflowsList) {
          console.log(`${workflow.id}  ${workflow.status.padEnd(8)}  steps=${workflow.steps.length}  ${workflow.name}`);
        }
      }
    } finally {
      store.close();
    }
  });

workflows.command("show <idOrName>").action((idOrName) => {
  const store = new Store();
  try {
    print(publicWorkflow(store.requireWorkflow(idOrName)));
  } finally {
    store.close();
  }
});

workflows.command("inspect <runId>").description("show a workflow run with steps and events").action((runId) => {
  const store = new Store();
  try {
    const run = store.requireWorkflowRun(runId);
    const steps = store.listWorkflowStepRuns(run.id);
    const events = store.listWorkflowEvents(run.id);
    const value = {
      workflowRun: publicWorkflowRun(run),
      steps: steps.map((step) => publicWorkflowStepRun(step)),
      events: events.map(publicWorkflowEvent),
    };
    if (isJson()) print(value);
    else {
      console.log(`${run.id}  ${run.status}  ${run.workflowName}`);
      for (const step of steps) {
        const publicStep = publicWorkflowStepRun(step);
        console.log(`  ${String(step.sequence).padStart(2, "0")}  ${step.status.padEnd(10)}  ${step.stepId}  ${publicStep.error ?? ""}`);
      }
      console.log(`  events=${events.length}`);
    }
  } finally {
    store.close();
  }
});

workflows
  .command("run <idOrName>")
  .option("--show-output", "show step stdout/stderr")
  .action(async (idOrName, opts) => {
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
    } finally {
      store.close();
    }
  });

workflows
  .command("runs [idOrName]")
  .option("--limit <n>", "limit", "50")
  .action((idOrName, opts) => {
    const store = new Store();
    try {
      const workflow = idOrName ? store.requireWorkflow(idOrName) : undefined;
      const runs = store.listWorkflowRuns({ workflowId: workflow?.id, limit: Number(opts.limit) });
      if (isJson()) print(runs.map(publicWorkflowRun));
      else {
        for (const run of runs) {
          console.log(`${run.id}  ${run.status.padEnd(10)}  ${run.workflowName}  started=${run.startedAt ?? "-"}`);
        }
      }
    } finally {
      store.close();
    }
  });

workflows
  .command("events <runId>")
  .option("--limit <n>", "limit", "200")
  .action((runId, opts) => {
    const store = new Store();
    try {
      const events = store.listWorkflowEvents(runId, Number(opts.limit));
      if (isJson()) print(events.map(publicWorkflowEvent));
      else {
        for (const event of events) {
          console.log(`${String(event.sequence).padStart(3, "0")}  ${event.eventType.padEnd(14)}  ${event.stepId ?? "-"}  ${event.createdAt}`);
        }
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

program
  .command("list")
  .alias("ls")
  .option("--status <status>", "filter by status")
  .option("--archived", "show only archived loops")
  .option("--all", "include archived loops")
  .action((opts) => {
    if (opts.archived && opts.all) throw new Error("use either --archived or --all, not both");
    const store = new Store();
    try {
      const loops = store.listLoops({ status: opts.status, archived: opts.archived, includeArchived: opts.all });
      if (isJson()) print(loops.map(publicLoop));
      else {
        for (const loop of loops) {
          const machine = loop.machine ? `  machine=${loop.machine.id}` : "";
          const archive = loop.archivedAt ? `  archived=${loop.archivedAt} from=${loop.archivedFromStatus ?? "-"}` : "";
          console.log(`${loop.id}  ${loop.status.padEnd(7)}  next=${loop.nextRunAt ?? "-"}  ${loop.name}${machine}${archive}`);
        }
      }
    } finally {
      store.close();
    }
  });

program.command("show <idOrName>").action((idOrName) => {
  const store = new Store();
  try {
    print(publicLoop(store.requireLoop(idOrName)));
  } finally {
    store.close();
  }
});

program
  .command("runs [idOrName]")
  .option("--limit <n>", "limit", "50")
  .option("--show-output", "show stdout/stderr")
  .action((idOrName, opts) => {
    const store = new Store();
    try {
      const loop = idOrName ? store.requireLoop(idOrName) : undefined;
      const runs = store.listRuns({ loopId: loop?.id, limit: Number(opts.limit) });
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
  });

program
  .command("expectations [idOrName]")
  .description("evaluate deterministic loop expectations without mutating external task systems")
  .option("--limit <n>", "maximum loops to inspect when no loop is specified", "200")
  .option("--json", "print JSON")
  .action((idOrName, opts) => {
    const store = new Store();
    try {
      const loops = idOrName ? [store.requireLoop(idOrName)] : store.listLoops({ limit: Number(opts.limit) });
      const values = loops.map((loop) => expectationForLoop(store, loop));
      if (isJson() || opts.json) console.log(JSON.stringify(idOrName ? values[0] : values, null, 2));
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
  });

const health = program
  .command("health")
  .description("summarize loop health and latest-run expectation status")
  .option("--json", "print JSON")
  .action((opts) => {
    const store = new Store();
    try {
      const report = buildHealthReport(store);
      if (isJson() || opts.json) console.log(JSON.stringify(report, null, 2));
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
  });

health
  .command("route-tasks")
  .description("upsert deduped todos tasks for failed loop health expectations")
  .option("--project <path>", "todos project path", defaultLoopsProject())
  .option("--task-list <slug>", "todos task-list slug", "loop-error-self-heal")
  .option("--limit <n>", "maximum loops to inspect", "200")
  .option("--max-actions <n>", "maximum todos tasks to upsert", "5")
  .option("--include-inactive", "also route stopped or expired loops")
  .option("--dry-run", "print intended task upserts without mutating todos")
  .option("--json", "print JSON")
  .action((opts) => {
    const store = new Store();
    try {
      const report = buildHealthReport(store, { limit: Number(opts.limit), includeInactive: Boolean(opts.includeInactive) });
      const failures = report.expectations.filter((entry) => !entry.ok && entry.recommendedTask);
      const selection = selectRouteItems(
        failures,
        Number(opts.maxActions),
        `health:${stableHash([opts.project, opts.taskList, opts.limit, Boolean(opts.includeInactive)])}`,
        (expectation) => expectation.recommendedTask!.dedupeKey,
      );
      const listId = opts.dryRun
        ? undefined
        : ensureTodosTaskList(
            opts.project,
            opts.taskList,
            "Loop Error Self Heal",
            "Deduped OpenLoops health expectation failures routed by loops health route-tasks.",
          );
      const actions = selection.selected.map((expectation) => {
        const task = expectation.recommendedTask!;
        const metadata = {
          source: "openloops.health.route-tasks",
          loop_id: expectation.loop.id,
          loop_name: expectation.loop.name,
          run_id: expectation.latestRun?.id,
          classification: expectation.failure?.classification,
          fingerprint: task.dedupeKey,
          no_tmux_dispatch: true,
        };
        if (opts.dryRun) {
          return { action: "would-upsert", title: task.title, fingerprint: task.dedupeKey, priority: task.priority, metadata };
        }
        const result = runLocalCommand("todos", [
          "--project",
          opts.project,
          "--json",
          "task",
          "upsert",
          "--fingerprint",
          task.dedupeKey,
          "--title",
          task.title,
          "-d",
          task.description,
          "--priority",
          task.priority,
          "--status",
          "pending",
          "--list",
          listId!,
          "--tags",
          task.tags.join(","),
          "--metadata-json",
          JSON.stringify(metadata),
        ]);
        if (!result.ok) {
          return { action: "upsert-failed", fingerprint: task.dedupeKey, error: result.stderr || result.error || result.stdout };
        }
        return { action: "upserted", fingerprint: task.dedupeKey, task: JSON.parse(result.stdout || "{}") };
      });
      const routed = {
        ok: actions.every((action) => action.action !== "upsert-failed"),
        inspected: report.summary.loops,
        failures: failures.length,
        routing: selection.cursor,
        actions,
      };
      if (!opts.dryRun && routed.ok) writeRouteCursor(selection.cursor.key, selection.cursor.lastFingerprint);
      if (isJson() || opts.json) console.log(JSON.stringify(routed, null, 2));
      else {
        console.log(`health_route_tasks inspected=${routed.inspected} failures=${routed.failures} actions=${actions.length}`);
        for (const action of actions) console.log(`${action.action} ${action.fingerprint}`);
      }
      if (!routed.ok) process.exitCode = 1;
    } finally {
      store.close();
    }
  });

const hygiene = program.command("hygiene").description("deterministic OpenLoops hygiene checks and safe repairs");

type HygieneCheckKind = "names" | "duplicates" | "scripts";

interface HygieneRouteTask {
  check: HygieneCheckKind;
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  tags: string[];
  fingerprint: string;
  metadata: Record<string, unknown>;
}

const HYGIENE_CHECKS: HygieneCheckKind[] = ["names", "duplicates", "scripts"];

function parseHygieneChecks(value: string | undefined): HygieneCheckKind[] {
  if (!value || value === "all") return HYGIENE_CHECKS;
  const checks = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const invalid = checks.filter((entry) => !HYGIENE_CHECKS.includes(entry as HygieneCheckKind));
  if (invalid.length > 0) throw new Error(`invalid hygiene check(s): ${invalid.join(", ")}`);
  return [...new Set(checks)] as HygieneCheckKind[];
}

function buildHygieneRouteTasks(
  store: Store,
  opts: { checks: HygieneCheckKind[]; includeInactive?: boolean; limit?: number; scriptsDir?: string },
): { checked: Record<HygieneCheckKind, number>; findings: number; tasks: HygieneRouteTask[] } {
  const checked: Record<HygieneCheckKind, number> = { names: 0, duplicates: 0, scripts: 0 };
  const tasks: HygieneRouteTask[] = [];
  const limit = opts.limit ?? 1_000;

  if (opts.checks.includes("names")) {
    const report = buildNameHygieneReport(store, { includeInactive: opts.includeInactive, limit });
    checked.names = report.checked;
    for (const change of report.changes.filter((entry) => entry.changed)) {
      const fingerprint = `openloops:hygiene:names:${change.id}:${stableHash([change.oldName, change.newName])}`;
      tasks.push({
        check: "names",
        title: `OpenLoops hygiene: rename loop ${change.oldName}`,
        description: [
          `OpenLoops name hygiene found a non-canonical loop name.`,
          `Loop: ${change.oldName} (${change.id})`,
          `Expected name: ${change.newName}`,
          `Scope: ${change.scope} / ${change.scopeSlug}`,
          `Fingerprint: ${fingerprint}`,
          "",
          "Acceptance:",
          "- Confirm the canonical name is correct for the loop scope.",
          "- Rename through OpenLoops CLI/API so ids, schedules, run history, and metadata are preserved.",
          "- Do not dispatch work by tmux.",
        ].join("\n"),
        priority: "low",
        tags: ["openloops", "hygiene", "name-hygiene"],
        fingerprint,
        metadata: {
          source: "openloops.hygiene.route-tasks",
          check: "names",
          loop_id: change.id,
          old_name: change.oldName,
          new_name: change.newName,
          scope: change.scope,
          scope_slug: change.scopeSlug,
          no_tmux_dispatch: true,
        },
      });
    }
  }

  if (opts.checks.includes("duplicates")) {
    const report = buildDuplicateOverlapReport(store, { includeInactive: opts.includeInactive, limit });
    checked.duplicates = report.checked;
    for (const group of report.groups) {
      const loopIds = group.loops.map((loop) => loop.id).sort();
      const fingerprint = `openloops:hygiene:duplicates:${stableHash([group.key, loopIds])}`;
      tasks.push({
        check: "duplicates",
        title: `OpenLoops hygiene: duplicate/overlapping loops - ${group.baseName}`,
        description: [
          `OpenLoops duplicate/overlap hygiene found multiple loops with the same normalized name, cwd, and schedule.`,
          `Base name: ${group.baseName}`,
          group.cwd ? `Cwd: ${group.cwd}` : undefined,
          `Schedule: ${group.schedule}`,
          `Fingerprint: ${fingerprint}`,
          "",
          "Loops:",
          ...group.loops.map((loop) => `- ${loop.id} ${loop.status} ${loop.name}`),
          "",
          "Acceptance:",
          "- Decide the authoritative active loop.",
          "- Archive or retarget superseded loops through OpenLoops CLI/API while preserving history.",
          "- Do not dispatch work by tmux.",
        ].filter(Boolean).join("\n"),
        priority: group.loops.some((loop) => loop.status === "active") ? "medium" : "low",
        tags: ["openloops", "hygiene", "duplicate-overlap"],
        fingerprint,
        metadata: {
          source: "openloops.hygiene.route-tasks",
          check: "duplicates",
          base_name: group.baseName,
          cwd: group.cwd,
          schedule: group.schedule,
          loop_ids: loopIds,
          no_tmux_dispatch: true,
        },
      });
    }
  }

  if (opts.checks.includes("scripts")) {
    const report = buildScriptInventoryReport(store, { includeInactive: opts.includeInactive, limit, scriptsDir: opts.scriptsDir });
    checked.scripts = report.checked;
    for (const loop of report.loops) {
      const fingerprint = `openloops:hygiene:scripts:${loop.id}:${stableHash([loop.command])}`;
      tasks.push({
        check: "scripts",
        title: `OpenLoops hygiene: replace script-backed loop ${loop.name}`,
        description: [
          `OpenLoops script inventory found a loop still backed by a local script command.`,
          `Loop: ${loop.name} (${loop.id})`,
          `Status: ${loop.status}`,
          loop.cwd ? `Cwd: ${loop.cwd}` : undefined,
          `Command: ${loop.command}`,
          `Fingerprint: ${fingerprint}`,
          "",
          "Acceptance:",
          "- Replace this loop with a package-level CLI/API/template abstraction when one exists.",
          "- If no abstraction exists, create/update the owning repo task instead of adding another local script.",
          "- Archive superseded loops through OpenLoops CLI/API and preserve history.",
          "- Do not dispatch work by tmux.",
        ].filter(Boolean).join("\n"),
        priority: loop.status === "active" ? "medium" : "low",
        tags: ["openloops", "hygiene", "script-backed-loop"],
        fingerprint,
        metadata: {
          source: "openloops.hygiene.route-tasks",
          check: "scripts",
          loop_id: loop.id,
          loop_name: loop.name,
          loop_status: loop.status,
          cwd: loop.cwd,
          script_matches: loop.scriptMatches,
          no_tmux_dispatch: true,
        },
      });
    }
  }

  return { checked, findings: tasks.length, tasks };
}

hygiene
  .command("names")
  .description("check or apply canonical machine-/repo-prefixed loop names")
  .option("--apply", "rename loops in-place")
  .option("--include-stopped", "include stopped loops")
  .option("--include-inactive", "include stopped, expired, and archived loops")
  .option("--limit <n>", "maximum loops to inspect", "1000")
  .option("--json", "print JSON")
  .action((opts) => {
    const store = new Store();
    try {
      const report = buildNameHygieneReport(store, {
        apply: false,
        includeStopped: Boolean(opts.includeStopped),
        includeInactive: Boolean(opts.includeInactive),
        limit: Number(opts.limit),
      });
      let outputReport = report;
      const backupPath = opts.apply && report.changed > 0 ? backupLoopsDatabase("name-hygiene") : undefined;
      if (opts.apply && report.changed > 0) {
        outputReport = buildNameHygieneReport(store, {
          apply: true,
          includeStopped: Boolean(opts.includeStopped),
          includeInactive: Boolean(opts.includeInactive),
          limit: Number(opts.limit),
        });
      } else if (opts.apply) {
        outputReport = { ...report, applied: true };
      }
      const output = backupPath ? { ...outputReport, backupPath } : outputReport;
      if (isJson() || opts.json) console.log(JSON.stringify(output, null, 2));
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
  });

hygiene
  .command("duplicates")
  .description("detect duplicate/overlapping loops with the same canonical name, cwd, and schedule")
  .option("--include-inactive", "include stopped, expired, and archived loops")
  .option("--limit <n>", "maximum loops to inspect", "1000")
  .option("--json", "print JSON")
  .action((opts) => {
    const store = new Store();
    try {
      const report = buildDuplicateOverlapReport(store, {
        includeInactive: Boolean(opts.includeInactive),
        limit: Number(opts.limit),
      });
      if (isJson() || opts.json) console.log(JSON.stringify(report, null, 2));
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
  });

hygiene
  .command("scripts")
  .description("inventory loops still backed by local ~/.hasna/loops/scripts commands")
  .option("--scripts-dir <path>", "script directory to detect")
  .option("--include-inactive", "include stopped, expired, and archived loops")
  .option("--limit <n>", "maximum loops to inspect", "1000")
  .option("--json", "print JSON")
  .action((opts) => {
    const store = new Store();
    try {
      const report = buildScriptInventoryReport(store, {
        scriptsDir: opts.scriptsDir,
        includeInactive: Boolean(opts.includeInactive),
        limit: Number(opts.limit),
      });
      if (isJson() || opts.json) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(`hygiene_scripts checked=${report.checked} script_backed=${report.scriptBacked}`);
        for (const loop of report.loops) console.log(`${loop.id}\t${loop.status}\t${loop.name}\t${loop.command}`);
      }
      if (!report.ok) process.exitCode = 1;
    } finally {
      store.close();
    }
  });

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
  .option("--dry-run", "print intended task upserts without mutating todos")
  .option("--json", "print JSON")
  .action((opts) => {
    const store = new Store();
    try {
      const checks = parseHygieneChecks(opts.checks);
      const route = buildHygieneRouteTasks(store, {
        checks,
        includeInactive: Boolean(opts.includeInactive),
        limit: Number(opts.limit),
        scriptsDir: opts.scriptsDir,
      });
      const selection = selectRouteItems(
        route.tasks,
        Number(opts.maxActions),
        `hygiene:${stableHash([opts.project, opts.taskList, checks, opts.limit, Boolean(opts.includeInactive), opts.scriptsDir ?? ""])}`,
        (task) => task.fingerprint,
      );
      const listId = opts.dryRun
        ? undefined
        : ensureTodosTaskList(
            opts.project,
            opts.taskList,
            "OpenLoops Hygiene",
            "Deduped OpenLoops hygiene findings routed by loops hygiene route-tasks.",
          );
      const actions = selection.selected.map((task) => {
        if (opts.dryRun) {
          return { action: "would-upsert", check: task.check, title: task.title, fingerprint: task.fingerprint, priority: task.priority, metadata: task.metadata };
        }
        const result = runLocalCommand("todos", [
          "--project",
          opts.project,
          "--json",
          "task",
          "upsert",
          "--fingerprint",
          task.fingerprint,
          "--title",
          task.title,
          "-d",
          task.description,
          "--priority",
          task.priority,
          "--status",
          "pending",
          "--list",
          listId!,
          "--tags",
          task.tags.join(","),
          "--metadata-json",
          JSON.stringify(task.metadata),
        ]);
        if (!result.ok) {
          return { action: "upsert-failed", check: task.check, fingerprint: task.fingerprint, error: result.stderr || result.error || result.stdout };
        }
        return { action: "upserted", check: task.check, fingerprint: task.fingerprint, task: JSON.parse(result.stdout || "{}") };
      });
      const routed = {
        ok: actions.every((action) => action.action !== "upsert-failed"),
        checks,
        checked: route.checked,
        findings: route.findings,
        routing: selection.cursor,
        actions,
      };
      if (!opts.dryRun && routed.ok) writeRouteCursor(selection.cursor.key, selection.cursor.lastFingerprint);
      if (isJson() || opts.json) console.log(JSON.stringify(routed, null, 2));
      else {
        console.log(`hygiene_route_tasks checks=${checks.join(",")} findings=${routed.findings} actions=${actions.length}`);
        for (const action of actions) console.log(`${action.action} ${action.fingerprint}`);
      }
      if (!routed.ok) process.exitCode = 1;
    } finally {
      store.close();
    }
  });

program.command("pause <idOrName>").action((idOrName) => updateStatus(idOrName, "paused"));
program.command("resume <idOrName>").action((idOrName) => updateStatus(idOrName, "active"));
program.command("stop <idOrName>").action((idOrName) => updateStatus(idOrName, "stopped"));

function updateStatus(idOrName: string, status: "paused" | "active" | "stopped"): void {
  const store = new Store();
  try {
    const loop = store.requireLoop(idOrName);
    if (loop.archivedAt) throw new Error(`loop is archived; run 'loops unarchive ${idOrName}' first`);
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

program.command("archive <idOrName>").description("archive a loop without deleting history").action((idOrName) => {
  const store = new Store();
  try {
    const loop = store.archiveLoop(idOrName);
    print(publicLoop(loop), `${loop.id} archived`);
  } finally {
    store.close();
  }
});

program.command("unarchive <idOrName>").alias("restore").description("restore an archived loop").action((idOrName) => {
  const store = new Store();
  try {
    const loop = store.unarchiveLoop(idOrName);
    print(publicLoop(loop), `${loop.id} ${loop.status}`);
  } finally {
    store.close();
  }
});

program
  .command("run-now <idOrName>")
  .option("--show-output", "show stdout/stderr")
  .action(async (idOrName, opts) => {
    const store = new Store();
    try {
      const loop = store.requireLoop(idOrName);
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

program.command("doctor").description("check local OpenLoops runtime dependencies and state").action(() => {
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

daemon.command("status").action(() => {
  const store = new Store();
  try {
    print(daemonStatus(store));
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
  .option("-n, --lines <n>", "lines", "80")
  .action((opts) => {
    const path = daemonLogPath();
    if (!existsSync(path)) {
      console.log("");
      return;
    }
    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    console.log(lines.slice(-Number(opts.lines)).join("\n"));
  });

await program.parseAsync(process.argv);
