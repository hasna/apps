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
import { accountToolForProvider, resolveAccountEnv, resolveAccountEnvSync } from "./accounts.js";
import { agentSessionContract, BoundedOutputBuffer, killProcessGroup, providerAdapter, spawnCapture, type AgentInvocation } from "./agent-adapter.js";
import { commandNotFoundMessage, executableExists, normalizeExecutionPath } from "./env.js";
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

function codewithProfileCandidatesFromJson(value: unknown): string[] {
  const candidates: string[] = [];
  const root = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  const addProfile = (entry: unknown): void => {
    if (!entry || typeof entry !== "object") return;
    const name = (entry as { name?: unknown }).name;
    if (typeof name === "string" && name) candidates.push(name);
  };
  const data = root?.data;
  if (Array.isArray(data)) data.forEach(addProfile);
  const profiles = root?.profiles;
  if (Array.isArray(profiles)) profiles.forEach(addProfile);
  return candidates;
}

function codewithProfileCandidatesFromOutput(output: string): string[] {
  const trimmed = output.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd >= jsonStart) {
    try {
      return codewithProfileCandidatesFromJson(JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)));
    } catch {
      // Fall back to the text parser for older Codewith profile-list output.
    }
  }
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
    const profileForError = codewithProfileForError(spec.nativeAuthProfile.profile);
    lines.push(
      `__OPENLOOPS_CODEWITH_PROFILE=${shellQuote(spec.nativeAuthProfile.profile)}`,
      "export __OPENLOOPS_CODEWITH_PROFILE",
      "__openloops_codewith_profile_list_contains() {",
      `  printf '%s\\n' "$__OPENLOOPS_CODEWITH_PROFILES" | awk '{ line = $0; gsub(/^[[:space:]]+|[[:space:]]+$/, "", line); if (line == "" || line == "No auth profiles saved.") next; if (line ~ /"(data|profiles)"[[:space:]]*:[[:space:]]*\\[/) { in_profiles = 1; next } if (in_profiles && line ~ /^\\]/) { in_profiles = 0; next } json = line; if (in_profiles && json ~ /"name"[[:space:]]*:[[:space:]]*"/) { sub(/^.*"name"[[:space:]]*:[[:space:]]*"/, "", json); sub(/".*$/, "", json); if (json == ENVIRON["__OPENLOOPS_CODEWITH_PROFILE"]) found = 1; next } split(line, cols, /[[:space:]]+/); candidate = (cols[1] == "*" ? cols[2] : cols[1]); if (candidate == "NAME" && (cols[2] == "ACCOUNT" || cols[3] == "ACCOUNT")) next; if (candidate == ENVIRON["__OPENLOOPS_CODEWITH_PROFILE"]) found = 1 } END { exit(found ? 0 : 1) }'`,
      "}",
      `if __OPENLOOPS_CODEWITH_PROFILES="$(${shellQuote(spec.command)} profile list --json 2>/dev/null)" && __openloops_codewith_profile_list_contains; then`,
      "  :",
      "else",
      `  __OPENLOOPS_CODEWITH_PROFILES="$(${shellQuote(spec.command)} profile list)" || {`,
      `    printf '%s\\n' ${shellQuote("codewith auth profile preflight failed")} >&2`,
      "    exit 1",
      "  }",
      "  if ! __openloops_codewith_profile_list_contains; then",
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
      `Verify ${machineId}'s host identity and repair SSH known_hosts/trust material outside OpenLoops;`,
      "OpenLoops will not disable host-key checking or modify known_hosts automatically.",
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
  return new Set(codewithProfileCandidatesFromOutput(result.stdout || ""));
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
  try {
    if (codewithProfileSetFromResult(jsonResult).has(spec.nativeAuthProfile.profile)) return;
  } catch {
    // Older Codewith CLIs do not support --json; fall back to the table output.
  }
  assertCodewithProfileListed(spec.nativeAuthProfile.profile, runProfileList(["profile", "list"]));
}

async function preflightNativeAuthProfile(spec: CommandSpec, env: NodeJS.ProcessEnv): Promise<void> {
  if (spec.nativeAuthProfile?.provider !== "codewith") return;
  const jsonResult = await spawnCapture(spec.command, ["profile", "list", "--json"], { env, timeoutMs: 15_000 });
  try {
    if (codewithProfileSetFromResult(jsonResult).has(spec.nativeAuthProfile.profile)) return;
  } catch {
    // Older Codewith CLIs do not support --json; fall back to the table output.
  }
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
 * (`--cd`/`--cwd`/`--dir`), and codewith durable agents rebuild their
 * start/control args from the recorded target.
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
  if (!error && exitCode !== 0 && codewithJsonlReconciledSuccess(spec, fields)) {
    return successResult(startedAt, fields);
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
    spec = worktreeFallbackSpec(spec, worktreeEntry.fallbackCwd) ?? spec;
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
  if (!error && exitCode !== 0 && codewithJsonlReconciledSuccess(spec, fields)) {
    return successResult(startedAt, fields);
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
