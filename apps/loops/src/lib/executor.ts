import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { LanguageModel } from "ai";
import type {
  AccountRef,
  AgentProvider,
  AgentSessionContract,
  AgentTarget,
  AgentWorktreeSpec,
  CommandTarget,
  ExecutableTarget,
  ExecutorResult,
  Loop,
  LoopMachineRef,
  LoopRun,
  PersistGuardOptions,
} from "../types.js";
import {
  ACCOUNTS_ENV_TIMEOUT_MS,
  accountDirEnvVar,
  accountToolForProvider,
  parseAccountExportLines,
  resolveAccountEnv,
  resolveAccountEnvSync,
} from "./accounts.js";
import { agentSessionContract, BoundedOutputBuffer, killProcessGroup, providerAdapter, spawnCapture, type AgentInvocation } from "./agent-adapter.js";
import { commandNotFoundMessage, executableExists, hasnaClientEnv, normalizeExecutionPath } from "./env.js";
import { nowIso } from "./ids.js";
import { refreshLoopMachine, resolveMachineCommand } from "./machines.js";
import { processStartTimeMs } from "./process-identity.js";
import { isRedactionPlaceholder, scrubSecrets } from "./redact.js";
import { resolvedCommandLine, shellQuote } from "./command-target.js";

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
/** Default idle watchdog for agent targets that set neither timeoutMs nor idleTimeoutMs. */
const DEFAULT_AGENT_IDLE_TIMEOUT_MS = 30 * 60_000;
/**
 * Providers whose CLIs emit no incremental output (claude/opencode/aicopilot
 * print a single JSON document on completion) or whose JSONL output can stay
 * quiet for long stretches (codewith exec).
 * Output-idle is a weak progress signal there, so the default watchdog gets a
 * much larger budget; it still reaps genuinely hung processes eventually.
 */
const BUFFERED_OUTPUT_PROVIDERS: ReadonlySet<AgentProvider> = new Set(["claude", "codewith", "opencode", "aicopilot"]);
const DEFAULT_BUFFERED_AGENT_IDLE_TIMEOUT_MS = 4 * 60 * 60_000;
const WORKTREE_GIT_TIMEOUT_MS = 5 * 60_000;
const CODEWITH_EXEC_FAST_FAILURE_MAX_MS = 2_000;
const CODEWITH_EXEC_RETRY_DELAYS_MS = [250, 750] as const;
const CODEWITH_RETRY_DIAGNOSTIC_MAX_BYTES = 2 * 1024;

export interface SpawnedProcessInfo {
  pid: number;
  pgid: number;
  processStartedAt: string;
}

export interface AgentProgressInfo {
  provider: AgentProvider;
  agentId?: string;
  status?: string;
  summary?: string;
  statusReason?: string;
  threadId?: string;
  rolloutPath?: string;
  pid?: number;
  lastEventSeq?: number;
}

export interface ExecuteOptions extends PersistGuardOptions {
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  goalModel?: LanguageModel;
  log?: (message: string) => void;
  signal?: AbortSignal;
  onSpawn?: (pid: number) => void;
  /** Children are spawned detached in their own process group, so pgid === pid. */
  onSpawnProcess?: (info: SpawnedProcessInfo) => void;
  /** Progress from durable provider controllers, for example Codewith background agents. */
  onAgentProgress?: (info: AgentProgressInfo) => void;
  machine?: LoopMachineRef;
  machineResolver?: (machine: LoopMachineRef) => LoopMachineRef;
  machineCommandResolver?: (machineId: string, command: string) => MachineCommandPlan;
}

export interface ExecutionMetadata {
  loopId?: string;
  loopName?: string;
  runId?: string;
  scheduledFor?: string;
  workflowId?: string;
  workflowName?: string;
  workflowRunId?: string;
  workflowStepId?: string;
  goalId?: string;
  goalObjective?: string;
  goalNodeKey?: string;
}

export interface PreflightResult {
  command: string;
  accountProfile?: string;
  accountTool?: string;
}

interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
  shell?: boolean;
  env?: Record<string, string>;
  timeoutMs?: number | null;
  idleTimeoutMs?: number;
  account?: AccountRef;
  accountTool?: string;
  nativeAuthProfile?: {
    provider: AgentProvider;
    profile: string;
  };
  preflightAnyOf?: string[];
  stdin?: string;
  allowlist?: {
    tools?: string[];
    commands?: string[];
    safetyReason?: string;
  };
  sessionContract?: AgentSessionContract;
  agentProvider?: AgentProvider;
  worktree?: AgentWorktreeSpec;
  /** Rebuild cwd-dependent provider argv/prompt from the original validated extraArgs snapshot. */
  invocationForCwd?: (cwd: string) => AgentInvocation;
}

interface MachineCommandPlan {
  command: string;
  args: string[];
  source: string;
}

const AUTH_ENV_KEYS = [
  "CLAUDE_CONFIG_DIR",
  "CODEWITH_HOME",
  "CODEX_HOME",
  "CURSOR_CONFIG_DIR",
  "CURSOR_API_KEY",
  "OPENCODE_CONFIG_DIR",
  "AICOPILOT_CONFIG_DIR",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
];

/** Agent CLIs the accounts CLI can resolve an active profile for. */
const AGENT_TOOL_NAMES = new Set(["claude", "cursor", "codewith", "codex", "opencode", "aicopilot"]);

const TRANSPORT_ENV_KEYS = new Set([
  "BUN_INSTALL",
  "HOME",
  "LANG",
  "LANGUAGE",
  "LOGNAME",
  "PATH",
  "SHELL",
  "SHLVL",
  "SSH_AGENT_PID",
  "SSH_AUTH_SOCK",
  "TERM",
  "TMP",
  "TMPDIR",
  "TEMP",
  "USER",
  "XDG_RUNTIME_DIR",
]);

type ResultFields = Partial<Omit<ExecutorResult, "status" | "startedAt" | "durationMs">>;

function buildResult(status: ExecutorResult["status"], startedAt: string, fields: ResultFields = {}): ExecutorResult {
  const finishedAt = fields.finishedAt ?? nowIso();
  return {
    status,
    exitCode: fields.exitCode,
    stdout: fields.stdout ?? "",
    stderr: fields.stderr ?? "",
    error: fields.error,
    pid: fields.pid,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
  };
}

function failureResult(startedAt: string, error: string, fields: ResultFields = {}): ExecutorResult {
  return buildResult("failed", startedAt, { ...fields, error });
}

function timeoutResult(startedAt: string, error: string, fields: ResultFields = {}): ExecutorResult {
  return buildResult("timed_out", startedAt, { ...fields, error });
}

function successResult(startedAt: string, fields: ResultFields = {}): ExecutorResult {
  return buildResult("succeeded", startedAt, fields);
}

/**
 * Incident 607176 — the "fake green" class: a run that reports `succeeded` with
 * exit 0 while the agent did nothing at all.
 *
 * The trigger was a redacted prompt. The control plane's runner-claim payload
 * ran the loop through `publicLoop`, so the runner received target.prompt as
 * the literal string "[redacted 152 chars]" and handed *that* to the provider
 * as the entire instruction. The provider replied "I don't see a task in your
 * message" and exited 0, and the runner recorded a green run. Four agent loops
 * had been reporting success for weeks without ever executing their prompt.
 *
 * Two guards, deliberately independent, because the one-line upstream fix only
 * closes the hop we already know about:
 *
 *   {@link agentPromptDeliveryFailure} is a PREcondition on the payload. It
 *   holds no matter which hop corrupts the prompt — API, transport, cache,
 *   spool, migration import, or a future one — because it validates at the
 *   point of use rather than trusting every hop in between.
 *
 *   {@link agentProducedNoOutput} is a POSTcondition on the process.
 *
 * What is deliberately NOT used as a signal: run duration. "Suspiciously
 * short" is not a property of a run, it is a property of a workload — the
 * probe that exposed this took 6.8s, while a legitimate agent that finds
 * nothing to do can finish faster than that. A duration threshold would fail
 * healthy runs and still miss a slow no-op, so it buys unreliability in both
 * directions. Both guards below are instead deterministic: each has a single
 * unambiguous trigger and no tunable.
 */
function agentPromptDeliveryFailure(target: ExecutableTarget): string | undefined {
  if (target.type !== "agent") return undefined;
  const prompt = (target as AgentTarget).prompt;
  if (prompt === undefined || prompt === null || prompt.trim().length === 0) {
    return "agent prompt is empty: refusing to start a provider with no instruction";
  }
  if (isRedactionPlaceholder(prompt)) {
    return `agent prompt was redacted before delivery (received ${JSON.stringify(prompt)}): ` +
      "the executor was handed a display placeholder instead of the real prompt, so the run was not started. " +
      "This means a layer between storage and the runner redacted target.prompt (see incident 607176).";
  }
  return undefined;
}

/**
 * An agent process that exits 0 having written nothing whatsoever to either
 * stream did not do the work. Every supported provider announces itself on
 * stdout — a result envelope under `--output-format json`, or at minimum the
 * assistant's text — so total silence means the agent never really ran.
 *
 * Scoped to agent targets on purpose: `command` loops legitimately succeed
 * without output (`true`, a quiet `rsync`, a no-change `git gc`), so applying
 * this to them would break working loops.
 */
function agentProducedNoOutput(spec: CommandSpec, fields: ResultFields): boolean {
  if (!spec.agentProvider) return false;
  return (fields.stdout ?? "").trim().length === 0 && (fields.stderr ?? "").trim().length === 0;
}

const AGENT_NO_OUTPUT_ERROR =
  "agent exited 0 with no output on stdout or stderr: the provider produced nothing, " +
  "so the run did no work and is not reported as succeeded";

const BWRAP_LOOPBACK_SETUP_ERROR = /\bbwrap:\s*loopback:\s*Failed RTM_NEWADDR:\s*Operation not permitted\b/i;

function jsonValueContainsExecutedCommand(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(jsonValueContainsExecutedCommand);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const completedCommand =
    record.type === "command_execution" &&
    (record.status === "completed" || typeof record.exit_code === "number" || typeof record.exitCode === "number");
  if (completedCommand && !BWRAP_LOOPBACK_SETUP_ERROR.test(JSON.stringify(record))) {
    return true;
  }
  return Object.values(record).some(jsonValueContainsExecutedCommand);
}

function jsonlContainsExecutedCommand(stdout: string): boolean {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;
    try {
      if (jsonValueContainsExecutedCommand(JSON.parse(trimmed))) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function agentCommandExecutionFailure(spec: CommandSpec, fields: ResultFields): string | undefined {
  if (spec.agentProvider !== "codewith" && spec.agentProvider !== "codex") return undefined;
  const output = `${fields.stdout ?? ""}\n${fields.stderr ?? ""}`;
  if (!BWRAP_LOOPBACK_SETUP_ERROR.test(output) || jsonlContainsExecutedCommand(fields.stdout ?? "")) return undefined;
  return "agent could not execute any command because sandbox setup failed: " +
    "bwrap loopback address setup was not permitted";
}

function codewithJsonlHasTerminalSuccess(stdout: string): boolean {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    if (record.type === "task_complete") return true;
    const payload = record.payload;
    if (payload && typeof payload === "object" && (payload as Record<string, unknown>).type === "task_complete") {
      return true;
    }
  }
  return false;
}

function codewithJsonlReconciledSuccess(spec: CommandSpec, fields: ResultFields): boolean {
  return spec.agentProvider === "codewith" && codewithJsonlHasTerminalSuccess(fields.stdout ?? "");
}

function codewithExecFailureLooksTransient(detail: string): boolean {
  const normalized = detail.trim();
  if (!normalized) return false;
  // Defense in depth for reachable, fast `codewith exec` contention. Legacy
  // `codewith agent start` diagnostics are deliberately excluded because that
  // dispatch path no longer exists.
  return /(?:SQLITE_BUSY|database is locked|Resource temporarily unavailable)/i.test(normalized);
}

function shouldRetryCodewithExecFailure(
  spec: CommandSpec,
  fields: ResultFields,
  error: string | undefined,
  attemptStartedAt: string,
  attemptFinishedAt: string,
  attemptIndex: number,
): boolean {
  if (attemptIndex >= CODEWITH_EXEC_RETRY_DELAYS_MS.length) return false;
  if (spec.agentProvider !== "codewith") return false;
  if (error || fields.exitCode !== 1) return false;
  if (codewithJsonlHasTerminalSuccess(fields.stdout ?? "")) return false;
  const durationMs = new Date(attemptFinishedAt).getTime() - new Date(attemptStartedAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs > CODEWITH_EXEC_FAST_FAILURE_MAX_MS) return false;
  return codewithExecFailureLooksTransient(`${fields.stderr ?? ""}\n${fields.stdout ?? ""}`);
}

function utf8Tail(value: string, maxBytes: number): string {
  const scrubbed = scrubSecrets(value);
  const encoded = Buffer.from(scrubbed, "utf8");
  if (encoded.length <= maxBytes) return scrubbed;
  if (maxBytes <= 0) return "";

  let marker = "";
  let retainedBytes = maxBytes;
  for (let pass = 0; pass < 3; pass += 1) {
    const droppedBytes = Math.max(0, encoded.length - retainedBytes);
    marker = `[truncated ${droppedBytes} bytes]\n`;
    retainedBytes = Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8"));
  }
  let start = Math.max(0, encoded.length - retainedBytes);
  while (start < encoded.length && (encoded[start] & 0b1100_0000) === 0b1000_0000) start++;
  return `${marker}${encoded.subarray(start).toString("utf8")}`;
}

function codewithExecRetryMessage(attemptIndex: number): string {
  return `retrying codewith exec after transient contention failure (${attemptIndex + 1}/${CODEWITH_EXEC_RETRY_DELAYS_MS.length + 1})`;
}

function codewithExecRetrySummary(attemptFields: ResultFields, attemptIndex: number): string {
  const diagnostic = utf8Tail(
    `${attemptFields.stderr ?? ""}\n${attemptFields.stdout ?? ""}`.trim(),
    CODEWITH_RETRY_DIAGNOSTIC_MAX_BYTES,
  );
  return `${codewithExecRetryMessage(attemptIndex)}\nfailed attempt ${attemptIndex + 1} diagnostic:\n${diagnostic || "(no output)"}`;
}

function stderrWithRetrySummaries(
  stderr: BoundedOutputBuffer,
  retrySummaries: readonly string[],
  maxOutputBytes: number,
): string {
  const tail = stderr.value();
  if (!retrySummaries.length) return tail;
  const prefix = `${retrySummaries.join("\n")}\n`;
  const tailBudget = Math.max(0, maxOutputBytes - Buffer.byteLength(prefix, "utf8"));
  return `${prefix}${utf8Tail(tail, tailBudget)}`;
}

async function waitForRetryDelay(delayMs: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return false;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    timer.unref();
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
  return !signal?.aborted;
}

function notifySpawn(pid: number | undefined, opts: ExecuteOptions): void {
  if (!pid) return;
  opts.onSpawn?.(pid);
  // Children are spawned detached, so they lead their own process group: pgid === pid.
  // Record the kernel's start time for the pid as the authoritative fingerprint,
  // not wall-clock now: a slow fork->record stall (>5s) would otherwise leave a
  // fingerprint that disagrees with what the kernel reports later, so recovery
  // would misjudge a live process as dead — abandoning the run and spawning a
  // duplicate. Fall back to now only when the start time is unresolvable.
  const startedMs = processStartTimeMs(pid);
  opts.onSpawnProcess?.({
    pid,
    pgid: pid,
    processStartedAt: startedMs !== undefined ? new Date(startedMs).toISOString() : nowIso(),
  });
}

function codewithProfileCandidateFromLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "No auth profiles saved.") return undefined;
  const cols = trimmed.split(/\s+/);
  const candidate = cols[0] === "*" ? cols[1] : cols[0];
  if (candidate === "NAME" && (cols[1] === "ACCOUNT" || cols[2] === "ACCOUNT")) return undefined;
  if (candidate === '"name":') {
    const jsonName = trimmed.match(/"name"\s*:\s*"([^"]+)"/)?.[1];
    if (jsonName) return jsonName;
  }
  return candidate;
}

interface CodewithProfileInventory {
  usable: Set<string>;
  unusable: Set<string>;
}

function codewithProfileInventoryFromJson(value: unknown): CodewithProfileInventory | undefined {
  const root = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  if (!root) return undefined;
  const entries: unknown[] = [];
  let hasProfileArray = false;
  if (Array.isArray(root.data)) {
    hasProfileArray = true;
    entries.push(...root.data);
  }
  if (Array.isArray(root.profiles)) {
    hasProfileArray = true;
    entries.push(...root.profiles);
  }
  if (!hasProfileArray) return undefined;
  const inventory: CodewithProfileInventory = {
    usable: new Set<string>(),
    unusable: new Set<string>(),
  };
  const addProfile = (entry: unknown): void => {
    if (!entry || typeof entry !== "object") return;
    const record = entry as { name?: unknown; usable?: unknown };
    if (typeof record.name !== "string" || !record.name) return;
    if (record.usable === false) {
      inventory.usable.delete(record.name);
      inventory.unusable.add(record.name);
      return;
    }
    if (!inventory.unusable.has(record.name)) inventory.usable.add(record.name);
  };
  entries.forEach(addProfile);
  return inventory;
}

function codewithProfileInventoryFromOutput(output: string): CodewithProfileInventory | undefined {
  const trimmed = output.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) return undefined;
  try {
    return codewithProfileInventoryFromJson(JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)));
  } catch {
    return undefined;
  }
}

function codewithProfileCandidatesFromText(output: string): string[] {
  return output.split(/\r?\n/).map(codewithProfileCandidateFromLine).filter(Boolean) as string[];
}

function codewithProfileForError(profile: string): string {
  return /[\u0000-\u001F\u007F]/.test(profile) ? (JSON.stringify(profile) ?? profile) : profile;
}

function assertCodewithAuthProfileSupported(profile: string): void {
  if (profile.includes("\0")) {
    throw new Error(`codewith auth profile contains unsupported NUL byte: ${codewithProfileForError(profile)}`);
  }
}

function metadataEnv(metadata: ExecutionMetadata): Record<string, string> {
  const env: Record<string, string> = {};
  if (metadata.loopId) env.LOOPS_LOOP_ID = metadata.loopId;
  if (metadata.loopName) env.LOOPS_LOOP_NAME = metadata.loopName;
  if (metadata.runId) env.LOOPS_RUN_ID = metadata.runId;
  if (metadata.scheduledFor) env.LOOPS_SCHEDULED_FOR = metadata.scheduledFor;
  if (metadata.workflowId) env.LOOPS_WORKFLOW_ID = metadata.workflowId;
  if (metadata.workflowName) env.LOOPS_WORKFLOW_NAME = metadata.workflowName;
  if (metadata.workflowRunId) env.LOOPS_WORKFLOW_RUN_ID = metadata.workflowRunId;
  if (metadata.workflowStepId) env.LOOPS_WORKFLOW_STEP_ID = metadata.workflowStepId;
  if (metadata.goalId) env.LOOPS_GOAL_ID = metadata.goalId;
  if (metadata.goalObjective) env.LOOPS_GOAL_OBJECTIVE = metadata.goalObjective;
  if (metadata.goalNodeKey) env.LOOPS_GOAL_NODE_KEY = metadata.goalNodeKey;
  return env;
}

function allowlistEnv(allowlist: CommandSpec["allowlist"], contract?: AgentSessionContract): Record<string, string> {
  const env: Record<string, string> = {};
  if (allowlist?.tools?.length) env.LOOPS_AGENT_ALLOWED_TOOLS = allowlist.tools.join(",");
  if (allowlist?.commands?.length) env.LOOPS_AGENT_ALLOWED_COMMANDS = allowlist.commands.join(",");
  if (allowlist?.tools?.length || allowlist?.commands?.length || allowlist?.safetyReason) env.LOOPS_AGENT_ALLOWLIST_ENFORCEMENT = "metadata_only";
  if (allowlist?.safetyReason) env.LOOPS_AGENT_ALLOWLIST_SAFETY_REASON = allowlist.safetyReason;
  if (contract) env.LOOPS_AGENT_SESSION_CONTRACT = JSON.stringify(contract);
  return env;
}

/** Exported for tests: resolves the default idle watchdog for agent targets. */
export function defaultAgentIdleTimeoutMs(target: AgentTarget, opts: ExecuteOptions): number | undefined {
  if (target.timeoutMs !== undefined || target.idleTimeoutMs !== undefined) return undefined;
  const raw = opts.env?.LOOPS_AGENT_IDLE_TIMEOUT_MS ?? process.env.LOOPS_AGENT_IDLE_TIMEOUT_MS;
  if (raw !== undefined && raw !== "") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "0" || normalized === "none" || normalized === "off") return undefined;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return BUFFERED_OUTPUT_PROVIDERS.has(target.provider)
    ? DEFAULT_BUFFERED_AGENT_IDLE_TIMEOUT_MS
    : DEFAULT_AGENT_IDLE_TIMEOUT_MS;
}

function commandSpec(target: ExecutableTarget, opts: ExecuteOptions): CommandSpec {
  if (target.type === "command") {
    const commandTarget = target as CommandTarget;
    return {
      command: commandTarget.command,
      args: commandTarget.args ?? [],
      cwd: commandTarget.cwd,
      shell: commandTarget.shell,
      env: commandTarget.env,
      timeoutMs: commandTarget.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : commandTarget.timeoutMs,
      idleTimeoutMs: commandTarget.idleTimeoutMs,
      account: commandTarget.account,
      accountTool: commandTarget.account?.tool,
    };
  }
  const agentTarget = target as AgentTarget;
  if (agentTarget.provider === "codewith" && agentTarget.authProfile) {
    assertCodewithAuthProfileSupported(agentTarget.authProfile);
  }
  const adapter = providerAdapter(agentTarget.provider);
  const preparedInvocation = adapter.prepareInvocation(agentTarget);
  const invocation = preparedInvocation.invocation;
  return {
    command: invocation.command,
    args: invocation.args,
    cwd: agentTarget.cwd,
    env: agentTarget.env,
    timeoutMs: agentTarget.timeoutMs ?? null,
    idleTimeoutMs: agentTarget.idleTimeoutMs ?? defaultAgentIdleTimeoutMs(agentTarget, opts),
    account: agentTarget.account,
    accountTool: agentTarget.account?.tool ?? accountToolForProvider(agentTarget.provider),
    nativeAuthProfile: agentTarget.authProfile
      ? { provider: agentTarget.provider, profile: agentTarget.authProfile }
      : undefined,
    preflightAnyOf: invocation.preflightAnyOf,
    stdin: invocation.stdin,
    allowlist: agentTarget.allowlist,
    sessionContract: agentSessionContract(agentTarget),
    agentProvider: agentTarget.provider,
    worktree: agentTarget.worktree,
    invocationForCwd: preparedInvocation.forCwd,
  };
}

/**
 * The agent CLI a target resolves to: a declared provider for agent targets, or
 * the first command token for command targets (the headless-claude case that
 * row e84f3956 measured). Unknown commands resolve to no tool and are untouched.
 */
function agentToolForSpec(spec: CommandSpec): string | undefined {
  if (spec.agentProvider) return accountToolForProvider(spec.agentProvider);
  const first = spec.command.trim().split(/\s+/, 1)[0];
  return first && AGENT_TOOL_NAMES.has(first) ? first : undefined;
}

/**
 * Fill-if-absent config-selecting env for a target whose tool is a configured
 * agent CLI but which carries no explicit account. Regression row
 * e84f3956-1083-4b4a-bb73-59f901b054b7 (measured 2026-07-30, runner-origin):
 * the runner's own process.env lacks CLAUDE_CONFIG_DIR under systemd/launchd
 * launchers, and neither the legacy cloud env files nor an explicit account supplies
 * it, so headless claude resolved to the DEFAULT account profile — a silent
 * identity switch (429 on the exhausted default, exit 1, zero cost, ~3s) while
 * the configured profile sat idle. `accounts env --tool <tool>` with no name
 * resolves the machine's ACTIVE profile — the same source interactive shells
 * get — and this applies only its config-selecting DIR var (the measured proof
 * of fix), never the API-key values. Any resolution failure degrades to the
 * current behaviour (the tool falls back to its own default) rather than
 * failing the run.
 */
async function activeProfileConfigEnv(
  spec: CommandSpec,
  opts: ExecuteOptions,
): Promise<Record<string, string> | undefined> {
  const tool = agentToolForSpec(spec);
  const key = tool ? accountDirEnvVar(tool) : undefined;
  if (!tool || !key) return undefined;
  const base = { ...(opts.env ?? process.env) };
  const result = await spawnCapture("accounts", ["env", "--tool", tool], {
    env: base,
    timeoutMs: ACCOUNTS_ENV_TIMEOUT_MS,
  });
  if (result.error || (result.status ?? 1) !== 0) return undefined;
  const parsed = parseAccountExportLines(result.stdout);
  const value = parsed[key];
  return value ? { [key]: value } : undefined;
}

function composeExecutionEnv(
  spec: CommandSpec,
  metadata: ExecutionMetadata,
  opts: ExecuteOptions,
  accountEnv: Record<string, string> | undefined,
  activeConfigEnv: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env) };
  // Machine-wide Hasna client config the runner's own process.env may be missing.
  // Fill-if-absent, and deliberately so: an inherited or caller-supplied value is
  // an explicit choice, while an absent one is the defect (todos de1f78af). This
  // sits ABOVE the account block on purpose, so AUTH_ENV_KEYS scrubbing and
  // per-target `spec.env` both still win over machine config.
  for (const [key, value] of Object.entries(hasnaClientEnv(env))) {
    if (!env[key]) env[key] = value;
  }
  // Active-profile config-selecting var, fill-if-absent, same precedence tier as
  // machine client config: explicit runner env, an explicit account, and
  // per-target `spec.env` all still win over it.
  if (activeConfigEnv) {
    for (const [key, value] of Object.entries(activeConfigEnv)) {
      if (!env[key]) env[key] = value;
    }
  }
  if (accountEnv) {
    for (const key of AUTH_ENV_KEYS) delete env[key];
    Object.assign(env, accountEnv);
  }
  Object.assign(env, spec.env ?? {});
  Object.assign(env, allowlistEnv(spec.allowlist, spec.sessionContract));
  env.PATH = normalizeExecutionPath(env);
  env.SHLVL ||= "1";
  Object.assign(env, metadataEnv(metadata));
  return env;
}

async function executionEnv(
  spec: CommandSpec,
  metadata: ExecutionMetadata,
  opts: ExecuteOptions,
): Promise<NodeJS.ProcessEnv> {
  const accountEnv = spec.account
    ? await resolveAccountEnv(spec.account, spec.accountTool, { ...(opts.env ?? process.env) })
    : undefined;
  const activeConfigEnv = accountEnv ? undefined : await activeProfileConfigEnv(spec, opts);
  return composeExecutionEnv(spec, metadata, opts, accountEnv, activeConfigEnv);
}

function executionEnvSync(
  spec: CommandSpec,
  metadata: ExecutionMetadata,
  opts: ExecuteOptions,
): NodeJS.ProcessEnv {
  const accountEnv = spec.account
    ? resolveAccountEnvSync(spec.account, spec.accountTool, { ...(opts.env ?? process.env) })
    : undefined;
  // The sync path is the preflight probe: it never executes the child, so the
  // active-profile fill (an async accounts spawn) is deliberately not applied.
  return composeExecutionEnv(spec, metadata, opts, accountEnv, undefined);
}

function resolvedMachine(opts: ExecuteOptions): LoopMachineRef | undefined {
  if (!opts.machine) return undefined;
  return (opts.machineResolver ?? refreshLoopMachine)(opts.machine);
}

function commandForShell(spec: CommandSpec): string {
  // Byte-identical to the control-plane digest's resolved line
  // (src/lib/command-target.ts): the digest binds exactly what runs.
  return resolvedCommandLine(spec);
}

function hereDoc(value: string, destinationVariable = "__OPENLOOPS_STDIN"): string[] {
  let delimiter = `__OPENLOOPS_STDIN_${randomBytes(8).toString("hex").toUpperCase()}__`;
  while (value.split(/\r?\n/).includes(delimiter)) {
    delimiter = `__OPENLOOPS_STDIN_${randomBytes(8).toString("hex").toUpperCase()}__`;
  }
  return [`cat > "$${destinationVariable}" <<'${delimiter}'`, value, delimiter];
}

function remoteBootstrapLines(
  spec: CommandSpec,
  metadata: ExecutionMetadata,
  opts: { worktree?: boolean } = {},
): string[] {
  const lines: string[] = [
    "set -e",
    'export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.npm-global/bin:$HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin${PATH:+:$PATH}"',
  ];
  // Worktree preparation must run before cd so a missing worktree fails
  // closed (mode=required) or falls back (mode=auto) with a clear message
  // instead of a generic cd error. It is skipped for preflight, which may
  // legitimately run before the worktree exists on the remote machine.
  const worktree = spec.worktree;
  const worktreeManaged = worktree?.enabled && (worktree.mode === "auto" || worktree.mode === "required");
  if (opts.worktree && worktree && worktreeManaged) {
    lines.push(...remoteWorktreePrepareLines(worktree));
    lines.push(...remoteWorktreeEnterLines(worktree, spec.cwd));
  } else if (worktree && worktreeManaged) {
    // Preflight: the managed worktree may not exist yet, so probe tooling
    // from the original checkout instead of cd-ing into an absent directory.
    lines.push(`cd ${shellQuote(worktree.originalCwd)}`);
  } else if (spec.cwd) {
    lines.push(`cd ${shellQuote(spec.cwd)}`);
  }
  if (spec.account) {
    if (!spec.accountTool) throw new Error("account.tool is required when no provider tool can be inferred");
    lines.push(
      "if ! command -v accounts >/dev/null 2>&1; then echo 'accounts CLI is not available on remote machine' >&2; exit 127; fi",
      `unset ${AUTH_ENV_KEYS.join(" ")}`,
      `eval "$(accounts env ${shellQuote(spec.account.profile)} --tool ${shellQuote(spec.accountTool)})"`,
      `export LOOPS_ACCOUNT_PROFILE=${shellQuote(spec.account.profile)}`,
      `export LOOPS_ACCOUNT_TOOL=${shellQuote(spec.accountTool)}`,
    );
  }
  for (const [key, value] of Object.entries({ ...metadataEnv(metadata), ...(spec.env ?? {}) })) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    lines.push(`export ${key}=${shellQuote(value)}`);
  }
  for (const [key, value] of Object.entries(allowlistEnv(spec.allowlist, spec.sessionContract))) {
    lines.push(`export ${key}=${shellQuote(value)}`);
  }
  return lines;
}

/**
 * Bash equivalent of {@link ensureLocalWorktree}, emitted into the remote
 * script so worktree-enabled targets work on machine-assigned loops without a
 * separate prepare step: reuse an existing worktree only when its top-level and
 * git common dir match. If its branch drifted, recover only when the checkout
 * is clean; otherwise return actionable cleanup evidence. The function uses
 * explicit `|| return 1` chains because bash disables `set -e` inside
 * functions invoked from `if` conditions.
 */
function remoteWorktreePrepareLines(worktree: AgentWorktreeSpec): string[] {
  const { repoRoot, path, branch } = worktree;
  if (!repoRoot || !path || !branch) {
    return [
      "__openloops_prepare_worktree() {",
      `  echo ${shellQuote("worktree preparation requires repoRoot, path, and branch metadata")} >&2`,
      "  return 1",
      "}",
    ];
  }
  return [
    "__openloops_prepare_worktree() {",
    `  local repo=${shellQuote(repoRoot)} path=${shellQuote(path)} branch=${shellQuote(branch)}`,
    "  local top expected_common actual_common current status recovered",
    '  if [ -L "$path" ]; then echo "refusing symlinked worktree path $path" >&2; return 1; fi',
    '  if [ -e "$path" ]; then',
    '    top="$(git -C "$path" rev-parse --show-toplevel 2>/dev/null)" || { echo "refusing to reuse non-worktree path: $path" >&2; return 1; }',
    '    if [ "$(cd "$top" 2>/dev/null && pwd -P)" != "$(cd "$path" 2>/dev/null && pwd -P)" ]; then echo "existing worktree top-level mismatch for $path: $top" >&2; return 1; fi',
    '    expected_common="$(cd "$repo" 2>/dev/null && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)"',
    '    actual_common="$(cd "$path" 2>/dev/null && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)"',
    '    if [ -z "$expected_common" ] || [ "$expected_common" != "$actual_common" ]; then echo "existing worktree $path belongs to a different git common dir" >&2; return 1; fi',
    '    current="$(git -C "$path" branch --show-current 2>/dev/null)"',
    '    if [ "$current" != "$branch" ]; then',
    '      status="$(git -C "$path" status --porcelain=v1 --untracked-files=all 2>/dev/null)" || { echo "existing worktree $path is on branch ${current:-unknown}, expected $branch, and cleanliness could not be checked; inspect or remove the stale worktree" >&2; return 1; }',
    '      if [ -n "$status" ]; then echo "existing worktree $path is on branch ${current:-unknown}, expected $branch, and has local changes; commit/stash them or remove the stale worktree before retrying" >&2; return 1; fi',
    '      if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then',
    '        git -C "$path" checkout "$branch" 1>&2 || { echo "existing worktree $path is clean but could not switch from branch ${current:-unknown} to expected $branch; remove/prune the stale worktree or free the branch before retrying" >&2; return 1; }',
    '      elif [ -z "$current" ]; then',
    '        git -C "$path" checkout -b "$branch" 1>&2 || { echo "existing worktree $path is clean but could not recreate expected branch $branch at the current detached HEAD; remove/prune the stale worktree before retrying" >&2; return 1; }',
    "      else",
    '        echo "existing worktree $path is on branch $current, expected $branch, but expected branch does not exist; remove/prune the stale worktree or recreate the expected branch before retrying" >&2; return 1',
    "      fi",
    '      recovered="$(git -C "$path" branch --show-current 2>/dev/null)"',
    '      if [ "$recovered" != "$branch" ]; then echo "existing worktree $path branch recovery ended on ${recovered:-unknown}, expected $branch; remove/prune the stale worktree before retrying" >&2; return 1; fi',
    "    fi",
    "    return 0",
    "  fi",
    '  git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "worktree repoRoot is not a git repository: $repo" >&2; return 1; }',
    '  mkdir -p "$(dirname "$path")" || return 1',
    "  # Preparation chatter goes to stderr so run stdout stays the agent's.",
    "  __openloops_worktree_add() {",
    '    if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then',
    '      git -C "$repo" worktree add "$path" "$branch"',
    "    else",
    '      git -C "$repo" worktree add -b "$branch" "$path" HEAD',
    "    fi",
    "  }",
    "  local __ol_add_out",
    '  if __ol_add_out="$(__openloops_worktree_add 2>&1)"; then',
    '    if [ -n "$__ol_add_out" ]; then printf "%s\\n" "$__ol_add_out" >&2; fi',
    "    return 0",
    "  fi",
    '  printf "%s\\n" "$__ol_add_out" >&2',
    "  # Self-heal git's own remedy for a stale 'missing but already registered",
    "  # worktree': prune the dead registration (metadata-only; the directory is",
    "  # already gone) and retry the add exactly once, then fail honestly.",
    '  case "$__ol_add_out" in',
    '    *"missing but already registered worktree"*)',
    '      git -C "$repo" worktree prune 1>&2 || true',
    '      __openloops_worktree_add 1>&2 || return 1',
    "      return 0",
    "      ;;",
    "  esac",
    "  return 1",
    "}",
  ];
}

/**
 * Enters the prepared worktree, mirroring {@link enterWorktree}: required mode
 * fails closed, auto mode falls back to the original checkout and records the
 * outcome in __OPENLOOPS_WORKTREE_OK so {@link remoteScript} can run the
 * fallback invocation (providers bake cwd into argv via --cd/--cwd/--dir).
 */
function remoteWorktreeEnterLines(worktree: AgentWorktreeSpec, cwd: string | undefined): string[] {
  const workdir = cwd ?? worktree.cwd;
  if (worktree.mode === "required") {
    return [
      "if ! __openloops_prepare_worktree; then",
      `  echo ${shellQuote("worktree preparation failed (mode=required)")} >&2`,
      "  exit 1",
      "fi",
      "__OPENLOOPS_WORKTREE_OK=1",
      `cd ${shellQuote(workdir)}`,
    ];
  }
  return [
    "if __openloops_prepare_worktree; then",
    "  __OPENLOOPS_WORKTREE_OK=1",
    `  cd ${shellQuote(workdir)}`,
    "else",
    `  echo ${shellQuote(`worktree preparation failed (mode=${worktree.mode}); falling back to ${worktree.originalCwd}`)} >&2`,
    "  __OPENLOOPS_WORKTREE_OK=0",
    `  cd ${shellQuote(worktree.originalCwd)}`,
    "fi",
  ];
}

function remoteScript(spec: CommandSpec, metadata: ExecutionMetadata, fallbackSpec?: CommandSpec): string {
  // Remote worktree preparation is executor-native (mirrors the local
  // enterWorktree path): mode=required prepares the worktree on the remote
  // machine and fails closed when preparation fails; mode=auto falls back to
  // the original checkout using the rebuilt fallback invocation.
  const lines = remoteBootstrapLines(spec, metadata, { worktree: true });
  const hasAutoFallback = Boolean(spec.worktree?.enabled && spec.worktree.mode === "auto" && fallbackSpec);

  let primaryStdinRedirect = "";
  if (hasAutoFallback) {
    if (spec.stdin !== undefined || fallbackSpec?.stdin !== undefined) {
      lines.push('__OPENLOOPS_STDIN=""', 'trap \'rm -f "$__OPENLOOPS_STDIN"\' EXIT');
    }
  } else if (spec.stdin !== undefined) {
    lines.push('__OPENLOOPS_STDIN="$(mktemp -t openloops-stdin.XXXXXX)"', 'trap \'rm -f "$__OPENLOOPS_STDIN"\' EXIT');
    lines.push(...hereDoc(spec.stdin));
    primaryStdinRedirect = ' < "$__OPENLOOPS_STDIN"';
  }

  const invocationFor = (invocationSpec: CommandSpec, stdinRedirect: string): string =>
    invocationSpec.shell
      ? `sh -c ${shellQuote(commandForShell(invocationSpec))}${stdinRedirect}`
      : `${[invocationSpec.command, ...invocationSpec.args].map(shellQuote).join(" ")}${stdinRedirect}`;
  const sessionContractLine = (invocationSpec: CommandSpec): string =>
    invocationSpec.sessionContract
      ? `export LOOPS_AGENT_SESSION_CONTRACT=${shellQuote(JSON.stringify(invocationSpec.sessionContract))}`
      : "unset LOOPS_AGENT_SESSION_CONTRACT";
  const fallbackBranchLines = (invocationSpec: CommandSpec): string[] => {
    const branchLines: string[] = [];
    let stdinRedirect = "";
    if (invocationSpec.stdin !== undefined) {
      branchLines.push('__OPENLOOPS_STDIN="$(mktemp -t openloops-stdin.XXXXXX)"');
      branchLines.push(...hereDoc(invocationSpec.stdin));
      stdinRedirect = ' < "$__OPENLOOPS_STDIN"';
    }
    branchLines.push(sessionContractLine(invocationSpec), invocationFor(invocationSpec, stdinRedirect));
    return branchLines;
  };
  if (hasAutoFallback && fallbackSpec) {
    lines.push(
      'if [ "${__OPENLOOPS_WORKTREE_OK:-0}" = 1 ]; then',
      ...fallbackBranchLines(spec),
      "else",
      ...fallbackBranchLines(fallbackSpec),
      "fi",
    );
  } else {
    lines.push(invocationFor(spec, primaryStdinRedirect));
  }
  return `${lines.join("\n")}\n`;
}

function remotePreflightScript(spec: CommandSpec, metadata: ExecutionMetadata): string {
  const lines = [
    ...remoteBootstrapLines(spec, metadata),
    "command -v bash >/dev/null 2>&1",
    `command -v ${shellQuote(spec.shell ? "sh" : spec.command)} >/dev/null 2>&1`,
  ];
  if (spec.preflightAnyOf?.length) {
    lines.push(
      `if ! ${spec.preflightAnyOf.map((command) => `command -v ${shellQuote(command)} >/dev/null 2>&1`).join(" && ! ")}; then`,
      `  echo 'none of required executables found: ${spec.preflightAnyOf.join(", ")}' >&2`,
      "  exit 127",
      "fi",
    );
  }
  if (spec.nativeAuthProfile?.provider === "codewith") {
    const profileForError = codewithProfileForError(spec.nativeAuthProfile.profile);
    lines.push(
      `__OPENLOOPS_CODEWITH_PROFILE=${shellQuote(spec.nativeAuthProfile.profile)}`,
      "export __OPENLOOPS_CODEWITH_PROFILE",
      "__openloops_codewith_table_contains() {",
      `  printf '%s\\n' "$__OPENLOOPS_CODEWITH_PROFILES" | awk '{ line = $0; gsub(/^[[:space:]]+|[[:space:]]+$/, "", line); if (line == "" || line == "No auth profiles saved.") next; split(line, cols, /[[:space:]]+/); candidate = (cols[1] == "*" ? cols[2] : cols[1]); if (candidate == "NAME" && (cols[2] == "ACCOUNT" || cols[3] == "ACCOUNT")) next; if (candidate == ENVIRON["__OPENLOOPS_CODEWITH_PROFILE"]) found = 1 } END { exit(found ? 0 : 1) }'`,
      "}",
      "__openloops_codewith_json_profile_state() {",
      `  printf '%s\\n' "$__OPENLOOPS_CODEWITH_PROFILES" | awk 'BEGIN { RS = "\\0" } { json = $0; gsub(/[\\r\\n]/, " ", json); if (json !~ /^[[:space:]]*\\{/ || json !~ /\\}[[:space:]]*$/) exit 2; gsub(/"(data|profiles)"[[:space:]]*:[[:space:]]*\\[/, "\\n&", json); section_count = split(json, sections, /\\n/); for (section_index = 1; section_index <= section_count; section_index++) { section = sections[section_index]; if (section !~ /^"(data|profiles)"[[:space:]]*:[[:space:]]*\\[/) continue; has_inventory = 1; sub(/^"(data|profiles)"[[:space:]]*:[[:space:]]*\\[/, "", section); sub(/\\].*$/, "", section); gsub(/\\}[[:space:]]*,[[:space:]]*\\{/, "}\\n{", section); entry_count = split(section, entries, /\\n/); for (entry_index = 1; entry_index <= entry_count; entry_index++) { entry = entries[entry_index]; if (entry !~ /"name"[[:space:]]*:[[:space:]]*"/) continue; name = entry; sub(/^.*"name"[[:space:]]*:[[:space:]]*"/, "", name); sub(/".*$/, "", name); if (name != ENVIRON["__OPENLOOPS_CODEWITH_PROFILE"]) continue; if (entry ~ /"usable"[[:space:]]*:[[:space:]]*false/) exit 3; found = 1 } } if (!has_inventory) exit 2; exit(found ? 0 : 4) }'`,
      "}",
      "__OPENLOOPS_CODEWITH_JSON_ERROR=\"$(mktemp -t openloops-codewith-profile.XXXXXX)\" || {",
      `  printf '%s\\n' ${shellQuote("codewith auth profile preflight failed")} >&2`,
      "  exit 1",
      "}",
      `if __OPENLOOPS_CODEWITH_PROFILES="$(${shellQuote(spec.command)} profile list --json 2>"$__OPENLOOPS_CODEWITH_JSON_ERROR")"; then`,
      "  if __openloops_codewith_json_profile_state; then",
      "    __OPENLOOPS_CODEWITH_JSON_STATE=0",
      "  else",
      "    __OPENLOOPS_CODEWITH_JSON_STATE=$?",
      "  fi",
      "  if [ \"$__OPENLOOPS_CODEWITH_JSON_STATE\" -eq 0 ]; then",
      "    rm -f \"$__OPENLOOPS_CODEWITH_JSON_ERROR\"",
      "    :",
      "  elif [ \"$__OPENLOOPS_CODEWITH_JSON_STATE\" -eq 2 ]; then",
      "    __OPENLOOPS_CODEWITH_FALLBACK=1",
      "  elif [ \"$__OPENLOOPS_CODEWITH_JSON_STATE\" -eq 3 ]; then",
      "    rm -f \"$__OPENLOOPS_CODEWITH_JSON_ERROR\"",
      `    printf '%s\\n' ${shellQuote(`codewith auth profile preflight failed: profile is unusable: ${profileForError}`)} >&2`,
      "    exit 1",
      "  else",
      "    rm -f \"$__OPENLOOPS_CODEWITH_JSON_ERROR\"",
      `    printf '%s\\n' ${shellQuote(`codewith auth profile not found: ${profileForError}`)} >&2`,
      "    exit 1",
      "  fi",
      "else",
      "  __OPENLOOPS_CODEWITH_JSON_STATUS=$?",
      "  __OPENLOOPS_CODEWITH_JSON_DETAIL=\"$(cat \"$__OPENLOOPS_CODEWITH_JSON_ERROR\")\"",
      "  if { [ \"$__OPENLOOPS_CODEWITH_JSON_STATUS\" -eq 2 ] || [ \"$__OPENLOOPS_CODEWITH_JSON_STATUS\" -eq 64 ]; } && printf '%s\\n' \"$__OPENLOOPS_CODEWITH_JSON_DETAIL\" | grep -Eiq -- '(--json.*(unknown|unsupported|unrecognized|unexpected|invalid)|(unknown|unsupported|unrecognized|unexpected|invalid).*(argument|option).*--json)'; then",
      "    __OPENLOOPS_CODEWITH_FALLBACK=1",
      "  else",
      "    rm -f \"$__OPENLOOPS_CODEWITH_JSON_ERROR\"",
      `    printf '%s\\n' ${shellQuote("codewith auth profile preflight failed")} >&2`,
      "    exit 1",
      "  fi",
      "fi",
      "rm -f \"$__OPENLOOPS_CODEWITH_JSON_ERROR\"",
      "if [ \"${__OPENLOOPS_CODEWITH_FALLBACK:-0}\" -eq 1 ]; then",
      `  __OPENLOOPS_CODEWITH_PROFILES="$(${shellQuote(spec.command)} profile list)" || {`,
      `    printf '%s\\n' ${shellQuote("codewith auth profile preflight failed")} >&2`,
      "    exit 1",
      "  }",
      "  if ! __openloops_codewith_table_contains; then",
      `    printf '%s\\n' ${shellQuote(`codewith auth profile not found: ${profileForError}`)} >&2`,
      "    exit 1",
      "  fi",
      "fi",
    );
  }
  return lines.join("\n");
}

function transportEnv(opts: ExecuteOptions): NodeJS.ProcessEnv {
  const source = opts.env ?? process.env;
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (TRANSPORT_ENV_KEYS.has(key) || key.startsWith("LC_")) env[key] = value;
  }
  env.PATH = normalizeExecutionPath(env);
  env.SHLVL ||= "1";
  return env;
}

function remotePreflightFailureMessage(machineId: string, detail: string): string {
  const normalized = detail.trim();
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|Offending .*key in .*known_hosts/i.test(normalized)) {
    return [
      `remote preflight failed on ${machineId}: SSH host key verification failed.`,
      `Verify ${machineId}'s host identity and repair SSH known_hosts/trust material outside Loops;`,
      "Loops will not disable host-key checking or modify known_hosts automatically.",
      normalized ? `Transport detail: ${normalized}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return `remote preflight failed on ${machineId}${normalized ? `: ${normalized}` : ""}`;
}

function assertCodewithProfileListed(
  profile: string,
  result: { status: number | null; stdout: string; stderr: string; error?: string },
): void {
  const profiles = codewithProfileSetFromResult(result);
  if (!profiles.has(profile)) {
    throw new Error(`codewith auth profile not found: ${codewithProfileForError(profile)}`);
  }
}

function codewithProfileSetFromResult(result: {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}): Set<string> {
  if (result.error) {
    throw new Error(`codewith auth profile preflight failed: ${result.error}`);
  }
  if ((result.status ?? 1) !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status ?? "unknown"}`).trim();
    throw new Error(`codewith auth profile preflight failed${detail ? `: ${detail}` : ""}`);
  }
  return new Set(codewithProfileCandidatesFromText(result.stdout || ""));
}

function codewithJsonModeUnsupported(result: {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}): boolean {
  if (result.error || (result.status !== 2 && result.status !== 64)) return false;
  const detail = `${result.stderr}\n${result.stdout}`;
  return /(?:--json.*(?:unknown|unsupported|unrecognized|unexpected|invalid)|(?:unknown|unsupported|unrecognized|unexpected|invalid).*(?:argument|option).*--json)/i.test(
    detail,
  );
}

function assertCodewithJsonProfileListed(
  profile: string,
  result: { status: number | null; stdout: string; stderr: string; error?: string },
): boolean {
  if (result.error) {
    throw new Error(`codewith auth profile preflight failed: ${result.error}`);
  }
  if ((result.status ?? 1) !== 0) {
    if (codewithJsonModeUnsupported(result)) return false;
    const detail = (result.stderr || result.stdout || `exit ${result.status ?? "unknown"}`).trim();
    throw new Error(`codewith auth profile preflight failed${detail ? `: ${detail}` : ""}`);
  }
  const inventory = codewithProfileInventoryFromOutput(result.stdout || "");
  if (!inventory) return false;
  if (inventory.unusable.has(profile)) {
    throw new Error(`codewith auth profile preflight failed: profile is unusable: ${codewithProfileForError(profile)}`);
  }
  if (!inventory.usable.has(profile)) {
    throw new Error(`codewith auth profile not found: ${codewithProfileForError(profile)}`);
  }
  return true;
}

function preflightNativeAuthProfileSync(spec: CommandSpec, env: NodeJS.ProcessEnv): void {
  if (spec.nativeAuthProfile?.provider !== "codewith") return;
  const runProfileList = (args: string[]) => {
    const result = spawnSync(spec.command, args, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error?.message,
    };
  };
  const jsonResult = runProfileList(["profile", "list", "--json"]);
  if (assertCodewithJsonProfileListed(spec.nativeAuthProfile.profile, jsonResult)) return;
  assertCodewithProfileListed(spec.nativeAuthProfile.profile, runProfileList(["profile", "list"]));
}

async function preflightNativeAuthProfile(spec: CommandSpec, env: NodeJS.ProcessEnv): Promise<void> {
  if (spec.nativeAuthProfile?.provider !== "codewith") return;
  const jsonResult = await spawnCapture(spec.command, ["profile", "list", "--json"], { env, timeoutMs: 15_000 });
  if (assertCodewithJsonProfileListed(spec.nativeAuthProfile.profile, jsonResult)) return;
  const tableResult = await spawnCapture(spec.command, ["profile", "list"], { env, timeoutMs: 15_000 });
  assertCodewithProfileListed(spec.nativeAuthProfile.profile, tableResult);
}

interface WorktreePreparation {
  cwd?: string;
  error?: string;
}

function spawnDetail(result: Awaited<ReturnType<typeof spawnCapture>>): string {
  return (result.stderr || result.stdout || result.error || "").toString().trim();
}

/**
 * Detects git's "missing but already registered worktree" error: the target
 * path is recorded in `.git/worktrees/` but its directory was deleted out from
 * under it, so `git worktree add` refuses. git's own prescribed remedy is
 * `git worktree prune` (or `add -f`). Left unhandled this terminal-fails worktree
 * prep on every attempt and the drain dedupes the failed item into a silent
 * wedge — historically the single biggest burner of the redispatch cap.
 */
export function isStaleWorktreeRegistration(detail: string | undefined): boolean {
  return typeof detail === "string" && /missing but already registered worktree/i.test(detail);
}

function resolvedDirEquals(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}

async function ensureLocalWorktree(
  worktree: AgentWorktreeSpec,
  env: NodeJS.ProcessEnv,
): Promise<WorktreePreparation> {
  const { repoRoot, path, branch } = worktree;
  if (!repoRoot || !path || !branch) {
    return { error: "worktree preparation requires repoRoot, path, and branch metadata" };
  }
  const git = (args: string[]): Promise<Awaited<ReturnType<typeof spawnCapture>>> =>
    spawnCapture("git", args, { env, timeoutMs: WORKTREE_GIT_TIMEOUT_MS });

  let stats: ReturnType<typeof lstatSync> | undefined;
  try {
    stats = lstatSync(path);
  } catch {
    stats = undefined;
  }
  if (stats?.isSymbolicLink()) return { error: `refusing symlinked worktree path ${path}` };

  const commonDir = async (base: string): Promise<string | undefined> => {
    const result = await git(["-C", base, "rev-parse", "--git-common-dir"]);
    if (result.error || (result.status ?? 1) !== 0) return undefined;
    const raw = result.stdout.trim();
    if (!raw) return undefined;
    try {
      return realpathSync(resolve(base, raw));
    } catch {
      return resolve(base, raw);
    }
  };

  if (stats) {
    const top = await git(["-C", path, "rev-parse", "--show-toplevel"]);
    if (top.error || (top.status ?? 1) !== 0) {
      return { error: `refusing to reuse non-worktree path: ${path}` };
    }
    if (!resolvedDirEquals(top.stdout.trim(), path)) {
      return { error: `existing worktree top-level mismatch for ${path}: ${top.stdout.trim()}` };
    }
    const expectedCommon = await commonDir(repoRoot);
    const actualCommon = await commonDir(path);
    if (!expectedCommon || expectedCommon !== actualCommon) {
      return { error: `existing worktree ${path} belongs to a different git common dir` };
    }
    const current = await git(["-C", path, "branch", "--show-current"]);
    const actualBranch = current.stdout.trim();
    if (current.error || (current.status ?? 1) !== 0) {
      return { error: `existing worktree ${path} branch could not be inspected${spawnDetail(current) ? `: ${spawnDetail(current)}` : ""}` };
    }
    if (actualBranch !== branch) {
      const actualLabel = actualBranch || "unknown";
      const status = await git(["-C", path, "status", "--porcelain=v1", "--untracked-files=all"]);
      if (status.error || (status.status ?? 1) !== 0) {
        const detail = spawnDetail(status);
        return {
          error: `existing worktree ${path} is on branch ${actualLabel}, expected ${branch}, and cleanliness could not be checked; inspect or remove the stale worktree${detail ? `: ${detail}` : ""}`,
        };
      }
      if (status.stdout.trim()) {
        return {
          error: `existing worktree ${path} is on branch ${actualLabel}, expected ${branch}, and has local changes; commit/stash them or remove the stale worktree before retrying`,
        };
      }
      const hasBranch = await git(["-C", repoRoot, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
      const checkout = hasBranch.status === 0
        ? await git(["-C", path, "checkout", branch])
        : actualBranch
          ? {
              status: 1,
              stdout: "",
              stderr: `existing worktree ${path} is on branch ${actualLabel}, expected ${branch}, but expected branch does not exist; remove/prune the stale worktree or recreate the expected branch before retrying`,
              signal: null,
              timedOut: false,
            }
          : await git(["-C", path, "checkout", "-b", branch]);
      if (checkout.error || (checkout.status ?? 1) !== 0) {
        const detail = spawnDetail(checkout);
        return {
          error: `existing worktree ${path} is clean but could not recover branch ${branch} from ${actualLabel}; remove/prune the stale worktree before retrying${detail ? `: ${detail}` : ""}`,
        };
      }
      const recovered = await git(["-C", path, "branch", "--show-current"]);
      if (recovered.error || (recovered.status ?? 1) !== 0 || recovered.stdout.trim() !== branch) {
        const recoveredBranch = recovered.stdout.trim() || "unknown";
        const detail = spawnDetail(recovered);
        return {
          error: `existing worktree ${path} branch recovery ended on ${recoveredBranch}, expected ${branch}; remove/prune the stale worktree before retrying${detail ? `: ${detail}` : ""}`,
        };
      }
    }
    return { cwd: worktree.cwd };
  }

  const inside = await git(["-C", repoRoot, "rev-parse", "--is-inside-work-tree"]);
  if (inside.error || (inside.status ?? 1) !== 0) {
    return { error: `worktree repoRoot is not a git repository: ${repoRoot}` };
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch (error) {
    return { error: `could not create worktree parent directory: ${error instanceof Error ? error.message : String(error)}` };
  }
  const hasBranch = await git(["-C", repoRoot, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  const runAdd = (): Promise<Awaited<ReturnType<typeof git>>> =>
    hasBranch.status === 0
      ? git(["-C", repoRoot, "worktree", "add", path, branch])
      : git(["-C", repoRoot, "worktree", "add", "-b", branch, path, "HEAD"]);
  let add = await runAdd();
  if ((add.error || (add.status ?? 1) !== 0) && isStaleWorktreeRegistration(spawnDetail(add))) {
    // Self-heal git's own prescribed remedy for a stale registration: prune the
    // dead entry (metadata-only; the directory is already gone) and retry the
    // add exactly once, then fail honestly if it still cannot proceed.
    await git(["-C", repoRoot, "worktree", "prune"]);
    add = await runAdd();
  }
  if (add.error || (add.status ?? 1) !== 0) {
    const detail = spawnDetail(add);
    return { error: `git worktree add failed for ${path}${detail ? `: ${detail}` : ""}` };
  }
  return { cwd: worktree.cwd };
}

interface WorktreeEntry {
  failure?: ExecutorResult;
  /** Set when auto mode fell back to the original checkout; callers must rebuild provider argv against this cwd. */
  fallbackCwd?: string;
}

/**
 * Prepares/enters the target's git worktree before spawn. Returns a failure
 * result when mode=required preparation fails (fail closed); auto mode falls
 * back to the original checkout by reporting `fallbackCwd` so the caller can
 * rebuild the invocation (providers bake cwd into argv via --cd/--cwd/--dir).
 */
async function enterWorktree(
  spec: CommandSpec,
  opts: ExecuteOptions,
  env: NodeJS.ProcessEnv,
  startedAt: string,
): Promise<WorktreeEntry | undefined> {
  const worktree = spec.worktree;
  if (!worktree?.enabled || worktree.mode === "off" || worktree.mode === "main") return undefined;
  const prepared = await ensureLocalWorktree(worktree, env);
  if (prepared.error) {
    if (worktree.mode === "required") {
      return { failure: failureResult(startedAt, `worktree preparation failed (mode=required): ${prepared.error}`) };
    }
    opts.log?.(`worktree preparation failed (mode=${worktree.mode}); falling back to ${worktree.originalCwd}: ${prepared.error}`);
    spec.cwd = worktree.originalCwd;
    return { fallbackCwd: worktree.originalCwd };
  }
  spec.cwd = prepared.cwd ?? spec.cwd;
  opts.log?.(`entered worktree ${worktree.path ?? spec.cwd}${worktree.branch ? ` branch ${worktree.branch}` : ""}`);
  return undefined;
}

/**
 * Rebuilds an agent command spec against the original checkout after an
 * auto-mode worktree fallback. Mutating `spec.cwd` alone is not enough:
 * codewith/codex/opencode/aicopilot bake the worktree cwd into argv
 * (`--cd`/`--cwd`/`--dir`).
 */
function worktreeFallbackSpec(spec: CommandSpec, fallbackCwd: string): CommandSpec | undefined {
  const invocation = spec.invocationForCwd?.(fallbackCwd);
  if (!invocation) return undefined;
  return {
    ...spec,
    command: invocation.command,
    args: invocation.args,
    cwd: fallbackCwd,
    preflightAnyOf: invocation.preflightAnyOf,
    stdin: invocation.stdin,
    sessionContract: spec.sessionContract ? { ...spec.sessionContract, cwd: fallbackCwd } : undefined,
    worktree: spec.worktree
      ? { ...spec.worktree, enabled: false, cwd: fallbackCwd, reason: "auto worktree preparation failed" }
      : undefined,
  };
}

function preflightRemoteSpec(
  spec: CommandSpec,
  machine: LoopMachineRef,
  metadata: ExecutionMetadata,
  opts: ExecuteOptions,
): void {
  const plan = (opts.machineCommandResolver ?? resolveMachineCommand)(machine.id, "bash -s");
  const result = spawnSync(plan.command, plan.args, {
    encoding: "utf8",
    env: transportEnv(opts),
    input: remotePreflightScript(spec, metadata),
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 15_000,
  });
  if (result.error) throw new Error(`remote preflight failed on ${machine.id}: ${result.error.message}`);
  if ((result.status ?? 1) !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status ?? "unknown"}`).trim();
    throw new Error(remotePreflightFailureMessage(machine.id, detail));
  }
}

async function executeRemoteSpec(
  spec: CommandSpec,
  machine: LoopMachineRef,
  metadata: ExecutionMetadata,
  opts: ExecuteOptions,
  fallbackSpec?: CommandSpec,
): Promise<ExecutorResult> {
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedAt = nowIso();
  let plan: MachineCommandPlan;
  let script: string;

  try {
    plan = (opts.machineCommandResolver ?? resolveMachineCommand)(machine.id, "bash -s");
    script = remoteScript(spec, metadata, fallbackSpec);
  } catch (err) {
    return failureResult(startedAt, err instanceof Error ? err.message : String(err));
  }

  const stderr = new BoundedOutputBuffer(maxOutputBytes);
  const retrySummaries: string[] = [];
  for (let attemptIndex = 0; ; attemptIndex += 1) {
    const attemptStartedAt = attemptIndex === 0 ? startedAt : nowIso();
    const stdout = new BoundedOutputBuffer(maxOutputBytes);
    const attemptStderr = new BoundedOutputBuffer(maxOutputBytes);
    let timedOut = false;
    let idleTimedOut = false;
    let exitCode: number | undefined;
    let error: string | undefined;

    const child = spawn(plan.command, plan.args, {
      env: transportEnv(opts),
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    notifySpawn(child.pid, opts);

    child.stdin?.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EPIPE") error = err.message;
    });
    child.stdin?.end(script);

    const abortHandler = (): void => {
      error = "cancelled";
      if (child.pid) killProcessGroup(child.pid);
    };
    if (opts.signal?.aborted) abortHandler();
    opts.signal?.addEventListener("abort", abortHandler, { once: true });

    const timer =
      typeof spec.timeoutMs === "number"
        ? setTimeout(() => {
            timedOut = true;
            if (child.pid) killProcessGroup(child.pid);
          }, spec.timeoutMs)
        : undefined;
    timer?.unref();
    let idleTimer: NodeJS.Timeout | undefined;
    const resetIdleTimer = (): void => {
      if (!spec.idleTimeoutMs) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimedOut = true;
        if (child.pid) killProcessGroup(child.pid);
      }, spec.idleTimeoutMs);
      idleTimer.unref();
    };
    resetIdleTimer();

    // Persistent-decoder encoding keeps multi-byte UTF-8 sequences split across
    // pipe chunks intact (see BoundedOutputBuffer).
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout.append(chunk);
      resetIdleTimer();
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr.append(chunk);
      attemptStderr.append(chunk);
      resetIdleTimer();
    });

    try {
      const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
      if (typeof code === "number") exitCode = code;
      if (signal) error = `terminated by ${signal}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (timer) clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      opts.signal?.removeEventListener("abort", abortHandler);
    }

    const attemptFinishedAt = nowIso();
    const fields: ResultFields = {
      exitCode,
      stdout: stdout.value(),
      stderr: stderrWithRetrySummaries(stderr, retrySummaries, maxOutputBytes),
      pid: child.pid,
      finishedAt: attemptFinishedAt,
    };
    const attemptFields: ResultFields = { ...fields, stderr: attemptStderr.value() };
    if (timedOut || idleTimedOut) {
      return timeoutResult(
        startedAt,
        idleTimedOut ? `idle timed out after ${spec.idleTimeoutMs}ms without stdout/stderr` : `timed out after ${spec.timeoutMs}ms`,
        fields,
      );
    }
    const commandExecutionFailure = agentCommandExecutionFailure(spec, fields);
    if (commandExecutionFailure) return failureResult(startedAt, commandExecutionFailure, fields);
    if (!error && exitCode !== 0 && codewithJsonlReconciledSuccess(spec, fields)) {
      return successResult(startedAt, fields);
    }
    if (error || exitCode !== 0) {
      if (shouldRetryCodewithExecFailure(spec, attemptFields, error, attemptStartedAt, attemptFinishedAt, attemptIndex)) {
        const retrySummary = codewithExecRetrySummary(attemptFields, attemptIndex);
        opts.log?.(codewithExecRetryMessage(attemptIndex));
        retrySummaries.push(retrySummary);
        fields.stderr = stderrWithRetrySummaries(stderr, retrySummaries, maxOutputBytes);
        if (await waitForRetryDelay(CODEWITH_EXEC_RETRY_DELAYS_MS[attemptIndex]!, opts.signal)) continue;
        return failureResult(startedAt, "cancelled", fields);
      }
      return failureResult(startedAt, error ?? `remote process on ${machine.id} exited with code ${exitCode ?? "unknown"}`, fields);
    }
    if (agentProducedNoOutput(spec, attemptFields)) return failureResult(startedAt, AGENT_NO_OUTPUT_ERROR, fields);
    return successResult(startedAt, fields);
  }
}

export function preflightTarget(
  target: ExecutableTarget,
  metadata: ExecutionMetadata = {},
  opts: ExecuteOptions = {},
): PreflightResult {
  const spec = commandSpec(target, opts);
  const machine = resolvedMachine(opts);
  if (machine && !machine.local) {
    preflightRemoteSpec(spec, machine, metadata, opts);
    return {
      command: spec.command,
      accountProfile: spec.account?.profile,
      accountTool: spec.accountTool,
    };
  }
  const env = executionEnvSync(spec, metadata, opts);
  if (!spec.shell && !executableExists(spec.command, env)) {
    throw new Error(commandNotFoundMessage(spec.command, env));
  }
  if (spec.preflightAnyOf?.length && !spec.preflightAnyOf.some((command) => executableExists(command, env))) {
    throw new Error(`none of required executables found: ${spec.preflightAnyOf.join(", ")}`);
  }
  preflightNativeAuthProfileSync(spec, env);
  return {
    command: spec.command,
    accountProfile: spec.account?.profile,
    accountTool: spec.accountTool,
  };
}

export async function executeTarget(
  target: ExecutableTarget,
  metadata: ExecutionMetadata = {},
  opts: ExecuteOptions = {},
): Promise<ExecutorResult> {
  // Before anything is spawned, locally or remotely: a prompt that never
  // survived delivery is a failed run, not a green one. See
  // agentPromptDeliveryFailure (incident 607176).
  const promptFailure = agentPromptDeliveryFailure(target);
  if (promptFailure) return failureResult(nowIso(), promptFailure);
  let spec = commandSpec(target, opts);
  const machine = resolvedMachine(opts);
  if (machine && !machine.local) {
    // Auto-mode worktree fallback needs a rebuilt invocation (providers bake
    // cwd into argv), so the remote script carries both and picks at runtime.
    const remoteFallbackSpec =
      spec.worktree?.enabled && spec.worktree.mode === "auto"
        ? worktreeFallbackSpec(spec, spec.worktree.originalCwd)
        : undefined;
    return executeRemoteSpec(spec, machine, metadata, opts, remoteFallbackSpec);
  }
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedAt = nowIso();

  const env = await executionEnv(spec, metadata, opts);
  if (!spec.shell && !executableExists(spec.command, env)) {
    return failureResult(startedAt, commandNotFoundMessage(spec.command, env));
  }
  if (spec.preflightAnyOf?.length && !spec.preflightAnyOf.some((command) => executableExists(command, env))) {
    return failureResult(startedAt, `none of required executables found: ${spec.preflightAnyOf.join(", ")}`);
  }
  try {
    await preflightNativeAuthProfile(spec, env);
  } catch (err) {
    return failureResult(startedAt, err instanceof Error ? err.message : String(err));
  }
  const worktreeEntry = await enterWorktree(spec, opts, env, startedAt);
  if (worktreeEntry?.failure) return worktreeEntry.failure;
  if (worktreeEntry?.fallbackCwd) {
    spec = worktreeFallbackSpec(spec, worktreeEntry.fallbackCwd) ?? spec;
    // executionEnv was composed from the primary worktree contract before
    // preparation. Refresh the generated agent metadata after the spec swap
    // without repeating account/credential resolution.
    Object.assign(env, allowlistEnv(spec.allowlist, spec.sessionContract));
  }

  const stderr = new BoundedOutputBuffer(maxOutputBytes);
  const retrySummaries: string[] = [];
  for (let attemptIndex = 0; ; attemptIndex += 1) {
    const attemptStartedAt = attemptIndex === 0 ? startedAt : nowIso();
    const stdout = new BoundedOutputBuffer(maxOutputBytes);
    const attemptStderr = new BoundedOutputBuffer(maxOutputBytes);
    let timedOut = false;
    let idleTimedOut = false;
    let exitCode: number | undefined;
    let error: string | undefined;

    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env,
      shell: spec.shell ?? false,
      detached: true,
      stdio: spec.stdin === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    });
    notifySpawn(child.pid, opts);

    if (spec.stdin !== undefined && child.stdin) {
      child.stdin.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EPIPE") error = err.message;
      });
      child.stdin.end(spec.stdin);
    }

    const abortHandler = (): void => {
      error = "cancelled";
      if (child.pid) killProcessGroup(child.pid);
    };
    if (opts.signal?.aborted) abortHandler();
    opts.signal?.addEventListener("abort", abortHandler, { once: true });

    const timer =
      typeof spec.timeoutMs === "number"
        ? setTimeout(() => {
            timedOut = true;
            if (child.pid) killProcessGroup(child.pid);
          }, spec.timeoutMs)
        : undefined;
    timer?.unref();
    let idleTimer: NodeJS.Timeout | undefined;
    const resetIdleTimer = (): void => {
      if (!spec.idleTimeoutMs) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimedOut = true;
        if (child.pid) killProcessGroup(child.pid);
      }, spec.idleTimeoutMs);
      idleTimer.unref();
    };
    resetIdleTimer();

    // Persistent-decoder encoding keeps multi-byte UTF-8 sequences split across
    // pipe chunks intact (see BoundedOutputBuffer).
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout.append(chunk);
      resetIdleTimer();
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr.append(chunk);
      attemptStderr.append(chunk);
      resetIdleTimer();
    });

    try {
      const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
      if (typeof code === "number") exitCode = code;
      if (signal) error = `terminated by ${signal}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (timer) clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      opts.signal?.removeEventListener("abort", abortHandler);
    }

    const attemptFinishedAt = nowIso();
    const fields: ResultFields = {
      exitCode,
      stdout: stdout.value(),
      stderr: stderrWithRetrySummaries(stderr, retrySummaries, maxOutputBytes),
      pid: child.pid,
      finishedAt: attemptFinishedAt,
    };
    const attemptFields: ResultFields = { ...fields, stderr: attemptStderr.value() };
    if (timedOut || idleTimedOut) {
      return timeoutResult(
        startedAt,
        idleTimedOut ? `idle timed out after ${spec.idleTimeoutMs}ms without stdout/stderr` : `timed out after ${spec.timeoutMs}ms`,
        fields,
      );
    }
    const commandExecutionFailure = agentCommandExecutionFailure(spec, fields);
    if (commandExecutionFailure) return failureResult(startedAt, commandExecutionFailure, fields);
    if (!error && exitCode !== 0 && codewithJsonlReconciledSuccess(spec, fields)) {
      return successResult(startedAt, fields);
    }
    if (error || exitCode !== 0) {
      if (shouldRetryCodewithExecFailure(spec, attemptFields, error, attemptStartedAt, attemptFinishedAt, attemptIndex)) {
        const retrySummary = codewithExecRetrySummary(attemptFields, attemptIndex);
        opts.log?.(codewithExecRetryMessage(attemptIndex));
        retrySummaries.push(retrySummary);
        fields.stderr = stderrWithRetrySummaries(stderr, retrySummaries, maxOutputBytes);
        if (await waitForRetryDelay(CODEWITH_EXEC_RETRY_DELAYS_MS[attemptIndex]!, opts.signal)) continue;
        return failureResult(startedAt, "cancelled", fields);
      }
      return failureResult(startedAt, error ?? `process exited with code ${exitCode ?? "unknown"}`, fields);
    }
    if (agentProducedNoOutput(spec, attemptFields)) return failureResult(startedAt, AGENT_NO_OUTPUT_ERROR, fields);
    return successResult(startedAt, fields);
  }
}

export async function executeLoop(loop: Loop, run: LoopRun, opts: ExecuteOptions = {}): Promise<ExecutorResult> {
  if (loop.target.type === "workflow") {
    throw new Error("workflow loop targets must be executed with executeLoopTarget");
  }
  if (loop.target.preflight?.beforeRun) {
    const startedAt = nowIso();
    try {
      preflightTarget(
        loop.target,
        {
          loopId: loop.id,
          loopName: loop.name,
          runId: run.id,
          scheduledFor: run.scheduledFor,
        },
        { ...opts, machine: opts.machine ?? loop.machine },
      );
    } catch (error) {
      return failureResult(startedAt, `runtime preflight failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return executeTarget(
    loop.target,
    {
      loopId: loop.id,
      loopName: loop.name,
      runId: run.id,
      scheduledFor: run.scheduledFor,
    },
    { ...opts, machine: opts.machine ?? loop.machine },
  );
}
