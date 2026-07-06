import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { LanguageModel } from "ai";
import type {
  AccountRef,
  AgentProvider,
  AgentTarget,
  AgentWorktreeSpec,
  CommandTarget,
  ExecutableTarget,
  ExecutorResult,
  KnowledgeFeedbackConfig,
  Loop,
  LoopMachineRef,
  LoopRun,
  PersistGuardOptions,
} from "../types.js";
import { accountToolForProvider, resolveAccountEnv, resolveAccountEnvSync } from "./accounts.js";
import { BoundedOutputBuffer, killProcessGroup, providerAdapter, spawnCapture } from "./agent-adapter.js";
import { commandNotFoundMessage, executableExists, normalizeExecutionPath } from "./env.js";
import { targetWithKnowledgeContext } from "./knowledge-feedback.js";
import { nowIso } from "./ids.js";
import { refreshLoopMachine, resolveMachineCommand } from "./machines.js";
import { processStartTimeMs } from "./process-identity.js";

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
/** Default idle watchdog for agent targets that set neither timeoutMs nor idleTimeoutMs. */
const DEFAULT_AGENT_IDLE_TIMEOUT_MS = 30 * 60_000;
/**
 * Providers whose CLIs emit no incremental output (claude/opencode/aicopilot
 * print a single JSON document on completion) or whose progress fingerprint
 * can legitimately stay constant during long work (codewith durable agents).
 * Output-idle is a weak progress signal there, so the default watchdog gets a
 * much larger budget; it still reaps genuinely hung processes eventually.
 */
const BUFFERED_OUTPUT_PROVIDERS: ReadonlySet<AgentProvider> = new Set(["claude", "codewith", "opencode", "aicopilot"]);
const DEFAULT_BUFFERED_AGENT_IDLE_TIMEOUT_MS = 4 * 60 * 60_000;
const WORKTREE_GIT_TIMEOUT_MS = 5 * 60_000;

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
  /** Inherited knowledge feedback config, used mainly by workflow loops for step agents. */
  knowledgeFeedback?: KnowledgeFeedbackConfig;
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
  };
  worktree?: AgentWorktreeSpec;
  codewithDurableAgent?: {
    target: AgentTarget;
  };
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

const TRANSPORT_ENV_KEYS = new Set([
  "BUN_INSTALL",
  "HOME",
  "LANG",
  "LANGUAGE",
  "LOGNAME",
  "PATH",
  "SHELL",
  "SSH_AGENT_PID",
  "SSH_AUTH_SOCK",
  "TERM",
  "TMP",
  "TMPDIR",
  "TEMP",
  "USER",
  "XDG_RUNTIME_DIR",
]);

function boundedText(text: string, maxBytes: number): string {
  const buffer = new BoundedOutputBuffer(maxBytes);
  buffer.append(text);
  return buffer.value();
}

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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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

function codewithAgentIdempotencyKey(metadata: ExecutionMetadata): string {
  const parts = [
    "openloops",
    metadata.workflowRunId ? `workflow-run:${metadata.workflowRunId}` : undefined,
    metadata.workflowStepId ? `step:${metadata.workflowStepId}` : undefined,
    metadata.runId ? `loop-run:${metadata.runId}` : undefined,
    metadata.loopId ? `loop:${metadata.loopId}` : undefined,
    metadata.scheduledFor ? `scheduled:${metadata.scheduledFor}` : undefined,
    metadata.goalId ? `goal:${metadata.goalId}` : undefined,
    metadata.goalNodeKey ? `node:${metadata.goalNodeKey}` : undefined,
  ].filter(Boolean);
  if (parts.length > 1) return parts.join(":");
  return `openloops:adhoc:${randomBytes(16).toString("hex")}`;
}

function allowlistEnv(allowlist: CommandSpec["allowlist"]): Record<string, string> {
  const env: Record<string, string> = {};
  if (allowlist?.tools?.length) env.LOOPS_AGENT_ALLOWED_TOOLS = allowlist.tools.join(",");
  if (allowlist?.commands?.length) env.LOOPS_AGENT_ALLOWED_COMMANDS = allowlist.commands.join(",");
  if (allowlist?.tools?.length || allowlist?.commands?.length) env.LOOPS_AGENT_ALLOWLIST_ENFORCEMENT = "metadata_only";
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
  const adapter = providerAdapter(agentTarget.provider);
  const invocation = adapter.buildInvocation(agentTarget);
  return {
    command: invocation.command,
    args: invocation.args,
    cwd: agentTarget.cwd,
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
    worktree: agentTarget.worktree,
    codewithDurableAgent: adapter.capabilities.durable ? { target: agentTarget } : undefined,
  };
}

function composeExecutionEnv(
  spec: CommandSpec,
  metadata: ExecutionMetadata,
  opts: ExecuteOptions,
  accountEnv: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env) };
  if (accountEnv) {
    for (const key of AUTH_ENV_KEYS) delete env[key];
    Object.assign(env, accountEnv);
  }
  Object.assign(env, spec.env ?? {});
  Object.assign(env, allowlistEnv(spec.allowlist));
  env.PATH = normalizeExecutionPath(env);
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
  return composeExecutionEnv(spec, metadata, opts, accountEnv);
}

function executionEnvSync(
  spec: CommandSpec,
  metadata: ExecutionMetadata,
  opts: ExecuteOptions,
): NodeJS.ProcessEnv {
  const accountEnv = spec.account
    ? resolveAccountEnvSync(spec.account, spec.accountTool, { ...(opts.env ?? process.env) })
    : undefined;
  return composeExecutionEnv(spec, metadata, opts, accountEnv);
}

function resolvedMachine(opts: ExecuteOptions): LoopMachineRef | undefined {
  if (!opts.machine) return undefined;
  return (opts.machineResolver ?? refreshLoopMachine)(opts.machine);
}

function commandForShell(spec: CommandSpec): string {
  if (!spec.args.length) return spec.command;
  return [spec.command, ...spec.args.map(shellQuote)].join(" ");
}

function hereDoc(value: string): string[] {
  let delimiter = `__OPENLOOPS_STDIN_${randomBytes(8).toString("hex").toUpperCase()}__`;
  while (value.split(/\r?\n/).includes(delimiter)) {
    delimiter = `__OPENLOOPS_STDIN_${randomBytes(8).toString("hex").toUpperCase()}__`;
  }
  return [`cat > "$__OPENLOOPS_STDIN" <<'${delimiter}'`, value, delimiter];
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
  for (const [key, value] of Object.entries(allowlistEnv(spec.allowlist))) {
    lines.push(`export ${key}=${shellQuote(value)}`);
  }
  return lines;
}

/**
 * Bash equivalent of {@link ensureLocalWorktree}, emitted into the remote
 * script so worktree-enabled targets work on machine-assigned loops without a
 * separate prepare step: reuse an existing worktree only when its top-level,
 * git common dir, and branch all match; otherwise `git worktree add` it. The
 * function uses explicit `|| return 1` chains because bash disables `set -e`
 * inside functions invoked from `if` conditions.
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
    "  local top expected_common actual_common current",
    '  if [ -L "$path" ]; then echo "refusing symlinked worktree path $path" >&2; return 1; fi',
    '  if [ -e "$path" ]; then',
    '    top="$(git -C "$path" rev-parse --show-toplevel 2>/dev/null)" || { echo "refusing to reuse non-worktree path: $path" >&2; return 1; }',
    '    if [ "$(cd "$top" 2>/dev/null && pwd -P)" != "$(cd "$path" 2>/dev/null && pwd -P)" ]; then echo "existing worktree top-level mismatch for $path: $top" >&2; return 1; fi',
    '    expected_common="$(cd "$repo" 2>/dev/null && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)"',
    '    actual_common="$(cd "$path" 2>/dev/null && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)"',
    '    if [ -z "$expected_common" ] || [ "$expected_common" != "$actual_common" ]; then echo "existing worktree $path belongs to a different git common dir" >&2; return 1; fi',
    '    current="$(git -C "$path" branch --show-current 2>/dev/null)"',
    '    if [ "$current" != "$branch" ]; then echo "existing worktree $path is on branch ${current:-unknown}, expected $branch" >&2; return 1; fi',
    "    return 0",
    "  fi",
    '  git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "worktree repoRoot is not a git repository: $repo" >&2; return 1; }',
    '  mkdir -p "$(dirname "$path")" || return 1',
    "  # Preparation chatter goes to stderr so run stdout stays the agent's.",
    '  if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then',
    '    git -C "$repo" worktree add "$path" "$branch" 1>&2 || return 1',
    "  else",
    '    git -C "$repo" worktree add -b "$branch" "$path" HEAD 1>&2 || return 1',
    "  fi",
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

  let stdinRedirect = "";
  if (spec.stdin !== undefined) {
    lines.push('__OPENLOOPS_STDIN="$(mktemp -t openloops-stdin.XXXXXX)"', 'trap \'rm -f "$__OPENLOOPS_STDIN"\' EXIT');
    lines.push(...hereDoc(spec.stdin));
    stdinRedirect = ' < "$__OPENLOOPS_STDIN"';
  }

  const invocationFor = (invocationSpec: CommandSpec): string =>
    invocationSpec.shell
      ? `sh -c ${shellQuote(commandForShell(invocationSpec))}${stdinRedirect}`
      : `${[invocationSpec.command, ...invocationSpec.args].map(shellQuote).join(" ")}${stdinRedirect}`;
  if (spec.worktree?.enabled && spec.worktree.mode === "auto" && fallbackSpec) {
    lines.push(
      'if [ "${__OPENLOOPS_WORKTREE_OK:-0}" = 1 ]; then',
      `  ${invocationFor(spec)}`,
      "else",
      `  ${invocationFor(fallbackSpec)}`,
      "fi",
    );
  } else {
    lines.push(invocationFor(spec));
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
    lines.push(
      `__OPENLOOPS_CODEWITH_PROFILES="$(${shellQuote(spec.command)} profile list)" || {`,
      `  printf '%s\\n' ${shellQuote("codewith auth profile preflight failed")} >&2`,
      "  exit 1",
      "}",
      `if ! printf '%s\\n' "$__OPENLOOPS_CODEWITH_PROFILES" | awk 'NR > 1 { print $1 }' | grep -Fx ${shellQuote(spec.nativeAuthProfile.profile)} >/dev/null; then`,
      `  printf '%s\\n' ${shellQuote(`codewith auth profile not found: ${spec.nativeAuthProfile.profile}`)} >&2`,
      "  exit 1",
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
  return env;
}

function assertCodewithProfileListed(
  profile: string,
  result: { status: number | null; stdout: string; stderr: string; error?: string },
): void {
  if (result.error) {
    throw new Error(`codewith auth profile preflight failed: ${result.error}`);
  }
  if ((result.status ?? 1) !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status ?? "unknown"}`).trim();
    throw new Error(`codewith auth profile preflight failed${detail ? `: ${detail}` : ""}`);
  }
  const profiles = new Set(
    (result.stdout || "")
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean),
  );
  if (!profiles.has(profile)) {
    throw new Error(`codewith auth profile not found: ${profile}`);
  }
}

function preflightNativeAuthProfileSync(spec: CommandSpec, env: NodeJS.ProcessEnv): void {
  if (spec.nativeAuthProfile?.provider !== "codewith") return;
  const result = spawnSync(spec.command, ["profile", "list"], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  });
  assertCodewithProfileListed(spec.nativeAuthProfile.profile, {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message,
  });
}

async function preflightNativeAuthProfile(spec: CommandSpec, env: NodeJS.ProcessEnv): Promise<void> {
  if (spec.nativeAuthProfile?.provider !== "codewith") return;
  const result = await spawnCapture(spec.command, ["profile", "list"], { env, timeoutMs: 15_000 });
  assertCodewithProfileListed(spec.nativeAuthProfile.profile, result);
}

function codewithAgentStartArgs(target: AgentTarget, idempotencyKey: string): string[] {
  const args = providerAdapter(target.provider).buildInvocation(target).args;
  const startIndex = args.findIndex((arg, index) => arg === "start" && args[index - 1] === "agent");
  if (startIndex === -1) throw new Error("internal error: codewith durable agent args missing agent start");
  args.splice(startIndex + 1, 0, "--idempotency-key", idempotencyKey);
  return args;
}

function codewithAgentControlArgs(target: AgentTarget, command: "read" | "logs" | "stop", agentId: string): string[] {
  return [
    ...(target.authProfile ? ["--auth-profile", target.authProfile] : []),
    "agent",
    command,
    ...(command === "logs" ? ["--limit", "20"] : []),
    agentId,
  ];
}

function parseJsonOutput(stdout: string, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(stdout || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${label} did not return JSON${error instanceof Error ? `: ${error.message}` : ""}`);
  }
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return field && typeof field === "object" && !Array.isArray(field) ? field as Record<string, unknown> : undefined;
}

function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === "string" ? field : undefined;
}

function numberField(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const field = value?.[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function codewithAgentStatus(readJson: Record<string, unknown>): string | undefined {
  return stringField(recordField(readJson, "agent"), "status") ?? stringField(recordField(readJson, "statusSnapshot"), "status");
}

function codewithAgentLastEventSeq(readJson: Record<string, unknown>): number | undefined {
  const agentSeq = numberField(recordField(readJson, "agent"), "lastEventSeq");
  const snapshotSeq = numberField(recordField(readJson, "statusSnapshot"), "lastEventSeq");
  if (agentSeq !== undefined && snapshotSeq !== undefined) return Math.max(agentSeq, snapshotSeq);
  return agentSeq ?? snapshotSeq;
}

function codewithAgentEvidence(startJson: Record<string, unknown>, readJson: Record<string, unknown>, logsJson?: Record<string, unknown>): string {
  const agent = recordField(readJson, "agent") ?? recordField(startJson, "agent");
  const statusSnapshot = recordField(readJson, "statusSnapshot");
  const events = Array.isArray(logsJson?.data)
    ? logsJson.data
        .filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === "object" && !Array.isArray(event))
        .map((event) => ({
          seq: numberField(event, "seq"),
          eventType: stringField(event, "eventType"),
          createdAt: numberField(event, "createdAt"),
        }))
    : undefined;
  return JSON.stringify(
    {
      codewithAgent: {
        agentId: stringField(agent, "agentId"),
        status: stringField(agent, "status"),
        desiredState: stringField(agent, "desiredState"),
        statusReason: stringField(agent, "statusReason"),
        threadId: stringField(agent, "threadId"),
        rolloutPath: stringField(agent, "rolloutPath"),
        pid: numberField(agent, "pid"),
        exitCode: numberField(agent, "exitCode"),
        created: typeof startJson.created === "boolean" ? startJson.created : undefined,
      },
      statusSnapshot: statusSnapshot
        ? {
            seq: numberField(statusSnapshot, "seq"),
            status: stringField(statusSnapshot, "status"),
            summary: stringField(statusSnapshot, "summary"),
            pendingInteractionCount: numberField(statusSnapshot, "pendingInteractionCount"),
            lastEventSeq: numberField(statusSnapshot, "lastEventSeq"),
          }
        : undefined,
      events,
    },
    null,
    2,
  );
}

function codewithAgentProgress(readJson: Record<string, unknown>): AgentProgressInfo {
  const agent = recordField(readJson, "agent");
  const statusSnapshot = recordField(readJson, "statusSnapshot");
  return {
    provider: "codewith",
    agentId: stringField(agent, "agentId"),
    status: stringField(agent, "status") ?? stringField(statusSnapshot, "status"),
    summary: stringField(statusSnapshot, "summary"),
    statusReason: stringField(agent, "statusReason"),
    threadId: stringField(agent, "threadId"),
    rolloutPath: stringField(agent, "rolloutPath"),
    pid: numberField(agent, "pid"),
    lastEventSeq: codewithAgentLastEventSeq(readJson),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeCodewithDurableAgent(
  spec: CommandSpec,
  metadata: ExecutionMetadata,
  opts: ExecuteOptions,
  env: NodeJS.ProcessEnv,
  startedAt: string,
): Promise<ExecutorResult> {
  const target = spec.codewithDurableAgent?.target;
  if (!target) throw new Error("internal error: missing codewith durable target");
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const idempotencyKey = codewithAgentIdempotencyKey(metadata);
  const start = await spawnCapture(spec.command, codewithAgentStartArgs(target, idempotencyKey), {
    cwd: spec.cwd,
    env,
    timeoutMs: 30_000,
    maxOutputBytes,
  });
  const stderr = new BoundedOutputBuffer(maxOutputBytes);
  stderr.append(start.stderr);
  if (start.error || (start.status ?? 1) !== 0) {
    return failureResult(startedAt, start.error ?? `codewith agent start exited with code ${start.status ?? "unknown"}`, {
      exitCode: start.status ?? undefined,
      stdout: start.stdout,
      stderr: stderr.value(),
    });
  }
  let startJson: Record<string, unknown>;
  try {
    startJson = parseJsonOutput(start.stdout || "{}", "codewith agent start");
  } catch (error) {
    return failureResult(startedAt, error instanceof Error ? error.message : String(error), { stdout: start.stdout, stderr: stderr.value() });
  }
  const agentId = stringField(recordField(startJson, "agent"), "agentId");
  if (!agentId) {
    return failureResult(startedAt, "codewith agent start did not return agent.agentId", { stdout: start.stdout, stderr: stderr.value() });
  }
  opts.onAgentProgress?.(codewithAgentProgress(startJson));

  const stopAgent = async (): Promise<void> => {
    await spawnCapture(spec.command, codewithAgentControlArgs(target, "stop", agentId), {
      cwd: spec.cwd,
      env,
      timeoutMs: 15_000,
      maxOutputBytes,
    });
  };

  const pollMs = Math.max(100, Number(opts.env?.LOOPS_CODEWITH_AGENT_POLL_MS ?? process.env.LOOPS_CODEWITH_AGENT_POLL_MS ?? 2_000) || 2_000);
  let lastReadJson = startJson;
  let lastLogsJson: Record<string, unknown> | undefined;
  let lastFingerprint: string | undefined;
  let lastProgressAt = Date.now();
  const evidence = (): string => boundedText(codewithAgentEvidence(startJson, lastReadJson, lastLogsJson), maxOutputBytes);
  while (true) {
    if (opts.signal?.aborted) {
      await stopAgent();
      return failureResult(startedAt, "cancelled", { stdout: evidence(), stderr: stderr.value() });
    }

    const read = await spawnCapture(spec.command, codewithAgentControlArgs(target, "read", agentId), {
      cwd: spec.cwd,
      env,
      timeoutMs: 30_000,
      maxOutputBytes,
    });
    stderr.append(read.stderr);
    if (read.error || (read.status ?? 1) !== 0) {
      return failureResult(startedAt, read.error ?? `codewith agent read exited with code ${read.status ?? "unknown"}`, {
        exitCode: read.status ?? undefined,
        stdout: evidence(),
        stderr: stderr.value(),
      });
    }
    try {
      lastReadJson = parseJsonOutput(read.stdout || "{}", "codewith agent read");
    } catch (error) {
      return failureResult(startedAt, error instanceof Error ? error.message : String(error), {
        stdout: boundedText(read.stdout, maxOutputBytes),
        stderr: stderr.value(),
      });
    }

    const status = codewithAgentStatus(lastReadJson);
    const fingerprint = JSON.stringify({
      status,
      agentLastEventSeq: numberField(recordField(lastReadJson, "agent"), "lastEventSeq"),
      snapshot: recordField(lastReadJson, "statusSnapshot") ?? null,
    });
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      lastProgressAt = Date.now();
      opts.onAgentProgress?.(codewithAgentProgress(lastReadJson));
    }
    if (status === "completed" || status === "failed" || status === "cancelled") {
      const logs = await spawnCapture(spec.command, codewithAgentControlArgs(target, "logs", agentId), {
        cwd: spec.cwd,
        env,
        timeoutMs: 30_000,
        maxOutputBytes,
      });
      if (!logs.error && (logs.status ?? 1) === 0) {
        try {
          lastLogsJson = parseJsonOutput(logs.stdout || "{}", "codewith agent logs");
        } catch {
          lastLogsJson = undefined;
        }
      } else {
        stderr.append(logs.stderr || logs.error || "");
      }
      if (status === "completed") {
        return successResult(startedAt, { exitCode: 0, stdout: evidence(), stderr: stderr.value() });
      }
      return failureResult(
        startedAt,
        stringField(recordField(lastReadJson, "agent"), "statusReason") ?? `codewith agent ${status}`,
        { exitCode: 1, stdout: evidence(), stderr: stderr.value() },
      );
    }

    if (typeof spec.timeoutMs === "number" && new Date(nowIso()).getTime() - new Date(startedAt).getTime() >= spec.timeoutMs) {
      await stopAgent();
      return timeoutResult(startedAt, `timed out after ${spec.timeoutMs}ms`, { stdout: evidence(), stderr: stderr.value() });
    }
    if (typeof spec.idleTimeoutMs === "number" && Date.now() - lastProgressAt >= spec.idleTimeoutMs) {
      await stopAgent();
      return timeoutResult(startedAt, `idle timed out after ${spec.idleTimeoutMs}ms without agent progress`, {
        stdout: evidence(),
        stderr: stderr.value(),
      });
    }
    await sleep(pollMs);
  }
}

interface WorktreePreparation {
  cwd?: string;
  error?: string;
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
    if (current.error || (current.status ?? 1) !== 0 || actualBranch !== branch) {
      return { error: `existing worktree ${path} is on branch ${actualBranch || "unknown"}, expected ${branch}` };
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
  const add = hasBranch.status === 0
    ? await git(["-C", repoRoot, "worktree", "add", path, branch])
    : await git(["-C", repoRoot, "worktree", "add", "-b", branch, path, "HEAD"]);
  if (add.error || (add.status ?? 1) !== 0) {
    const detail = (add.stderr || add.stdout || add.error || "").toString().trim();
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
 * (`--cd`/`--cwd`/`--dir`), and codewith durable agents rebuild their
 * start/control args from the recorded target.
 */
function worktreeFallbackSpec(target: ExecutableTarget, opts: ExecuteOptions, fallbackCwd: string): CommandSpec | undefined {
  if (target.type !== "agent") return undefined;
  const agentTarget = target as AgentTarget;
  const fallbackTarget: AgentTarget = {
    ...agentTarget,
    cwd: fallbackCwd,
    worktree: agentTarget.worktree
      ? { ...agentTarget.worktree, enabled: false, cwd: fallbackCwd, reason: "auto worktree preparation failed" }
      : undefined,
  };
  return commandSpec(fallbackTarget, opts);
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
    throw new Error(`remote preflight failed on ${machine.id}${detail ? `: ${detail}` : ""}`);
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
  const stdout = new BoundedOutputBuffer(maxOutputBytes);
  const stderr = new BoundedOutputBuffer(maxOutputBytes);
  let timedOut = false;
  let idleTimedOut = false;
  let exitCode: number | undefined;
  let error: string | undefined;
  let plan: MachineCommandPlan;
  let script: string;

  try {
    plan = (opts.machineCommandResolver ?? resolveMachineCommand)(machine.id, "bash -s");
    script = remoteScript(spec, metadata, fallbackSpec);
  } catch (err) {
    return failureResult(startedAt, err instanceof Error ? err.message : String(err));
  }

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

  const fields: ResultFields = { exitCode, stdout: stdout.value(), stderr: stderr.value(), pid: child.pid };
  if (timedOut || idleTimedOut) {
    return timeoutResult(
      startedAt,
      idleTimedOut ? `idle timed out after ${spec.idleTimeoutMs}ms without stdout/stderr` : `timed out after ${spec.timeoutMs}ms`,
      fields,
    );
  }
  if (error || exitCode !== 0) {
    return failureResult(startedAt, error ?? `remote process on ${machine.id} exited with code ${exitCode ?? "unknown"}`, fields);
  }
  return successResult(startedAt, fields);
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
  let executionTarget = await targetWithKnowledgeContext(target, metadata, {
    env: opts.env,
    log: opts.log,
    knowledgeFeedback: opts.knowledgeFeedback,
  });
  let spec = commandSpec(executionTarget, opts);
  const machine = resolvedMachine(opts);
  if (machine && !machine.local && spec.codewithDurableAgent) {
    return failureResult(
      nowIso(),
      "remote Codewith durable background-agent steps require remote status polling support; run this Codewith step locally or add remote durable readback before dispatch",
    );
  }
  if (machine && !machine.local) {
    // Auto-mode worktree fallback needs a rebuilt invocation (providers bake
    // cwd into argv), so the remote script carries both and picks at runtime.
    const remoteFallbackSpec =
      spec.worktree?.enabled && spec.worktree.mode === "auto"
        ? worktreeFallbackSpec(executionTarget, opts, spec.worktree.originalCwd)
        : undefined;
    return executeRemoteSpec(spec, machine, metadata, opts, remoteFallbackSpec);
  }
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedAt = nowIso();
  const stdout = new BoundedOutputBuffer(maxOutputBytes);
  const stderr = new BoundedOutputBuffer(maxOutputBytes);
  let timedOut = false;
  let idleTimedOut = false;
  let exitCode: number | undefined;
  let error: string | undefined;

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
    spec = worktreeFallbackSpec(executionTarget, opts, worktreeEntry.fallbackCwd) ?? spec;
  }
  if (spec.codewithDurableAgent) {
    return executeCodewithDurableAgent(spec, metadata, opts, env, startedAt);
  }

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

  const fields: ResultFields = { exitCode, stdout: stdout.value(), stderr: stderr.value(), pid: child.pid };
  if (timedOut || idleTimedOut) {
    return timeoutResult(
      startedAt,
      idleTimedOut ? `idle timed out after ${spec.idleTimeoutMs}ms without stdout/stderr` : `timed out after ${spec.timeoutMs}ms`,
      fields,
    );
  }
  if (error || exitCode !== 0) {
    return failureResult(startedAt, error ?? `process exited with code ${exitCode ?? "unknown"}`, fields);
  }
  return successResult(startedAt, fields);
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
