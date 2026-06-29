import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { resolveMachineCommand } from "@hasna/machines/consumer";
import type {
  AccountRef,
  AgentProvider,
  AgentTarget,
  CommandTarget,
  ExecutableTarget,
  ExecutorResult,
  Loop,
  LoopMachineRef,
  LoopRun,
  PersistGuardOptions,
} from "../types.js";
import { accountToolForProvider, resolveAccountEnv } from "./accounts.js";
import { commandNotFoundMessage, executableExists, normalizeExecutionPath } from "./env.js";
import { nowIso } from "./ids.js";
import { refreshLoopMachine } from "./machines.js";

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

export interface ExecuteOptions extends PersistGuardOptions {
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  signal?: AbortSignal;
  onSpawn?: (pid: number) => void;
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
  timeoutMs: number;
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

function appendBounded(current: string, chunk: Buffer, maxBytes: number): string {
  const next = current + chunk.toString("utf8");
  if (Buffer.byteLength(next, "utf8") <= maxBytes) return next;
  const overflow = Buffer.byteLength(next, "utf8") - maxBytes;
  return `[truncated ${overflow} bytes]\n${next.slice(-maxBytes)}`;
}

function killProcessGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }, 2_000).unref();
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

function allowlistEnv(allowlist: CommandSpec["allowlist"]): Record<string, string> {
  const env: Record<string, string> = {};
  if (allowlist?.tools?.length) env.LOOPS_AGENT_ALLOWED_TOOLS = allowlist.tools.join(",");
  if (allowlist?.commands?.length) env.LOOPS_AGENT_ALLOWED_COMMANDS = allowlist.commands.join(",");
  if (allowlist?.tools?.length || allowlist?.commands?.length) env.LOOPS_AGENT_ALLOWLIST_ENFORCEMENT = "metadata_only";
  return env;
}

function providerCommand(provider: AgentProvider): string {
  switch (provider) {
    case "claude":
      return "claude";
    case "cursor":
      return "sh";
    case "codewith":
      return "codewith";
    case "aicopilot":
      return "aicopilot";
    case "opencode":
      return "opencode";
    case "codex":
      return "codex";
  }
}

function codewithLikeSandbox(target: AgentTarget): "read-only" | "workspace-write" | "danger-full-access" {
  const sandbox = target.sandbox ?? (target.permissionMode === "bypass" ? "danger-full-access" : "workspace-write");
  if (sandbox !== "read-only" && sandbox !== "workspace-write" && sandbox !== "danger-full-access") {
    throw new Error(`${target.provider} sandbox must be read-only, workspace-write, or danger-full-access`);
  }
  return sandbox;
}

function configStringValue(value: string): string {
  return JSON.stringify(value);
}

function assertStringOption(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== "string") throw new Error(`${label} must be a string`);
}

function assertSupportedAgentOptions(target: AgentTarget): void {
  assertStringOption(target.variant, `${target.provider}.variant`);
  assertStringOption(target.model, `${target.provider}.model`);
  assertStringOption(target.agent, `${target.provider}.agent`);
  assertStringOption(target.authProfile, `${target.provider}.authProfile`);
  if (target.authProfile !== undefined && target.provider !== "codewith") {
    throw new Error(`${target.provider}.authProfile is supported only for codewith`);
  }
  if (target.addDirs?.length && !["codewith", "codex"].includes(target.provider)) {
    throw new Error(`${target.provider}.addDirs is currently supported only for codewith or codex`);
  }
  if (target.permissionMode && !["default", "plan", "auto", "bypass"].includes(target.permissionMode)) {
    throw new Error(`${target.provider}.permissionMode must be default, plan, auto, or bypass`);
  }
  if (target.sandbox && !["read-only", "workspace-write", "danger-full-access", "enabled", "disabled"].includes(target.sandbox)) {
    throw new Error(`${target.provider}.sandbox is not supported: ${target.sandbox}`);
  }
  if (["codewith", "codex"].includes(target.provider)) {
    if (target.permissionMode && !["default", "bypass"].includes(target.permissionMode)) {
      throw new Error(`${target.provider}.permissionMode supports only default or bypass`);
    }
    if (target.sandbox) codewithLikeSandbox(target);
    return;
  }
  if (target.provider === "claude") {
    if (target.sandbox !== undefined) throw new Error("claude.sandbox is not supported");
    return;
  }
  if (target.provider === "cursor") {
    if (target.permissionMode === "auto") throw new Error("cursor.permissionMode auto is not supported; use provider-specific extraArgs for Cursor auto-review");
    if (target.sandbox !== undefined && target.sandbox !== "enabled" && target.sandbox !== "disabled") {
      throw new Error("cursor.sandbox must be enabled or disabled");
    }
    return;
  }
  if (target.permissionMode && !["default", "bypass"].includes(target.permissionMode)) {
    throw new Error(`${target.provider}.permissionMode supports only default or bypass`);
  }
  if (target.sandbox !== undefined) throw new Error(`${target.provider}.sandbox is not supported`);
}

function agentArgs(target: AgentTarget): string[] {
  assertSupportedAgentOptions(target);
  const isolation = target.configIsolation ?? "safe";
  const permissionMode = target.permissionMode ?? "default";
  const args: string[] = [];
  switch (target.provider) {
    case "claude":
      if (isolation === "safe") args.push("--safe-mode", "--setting-sources", "local", "--no-session-persistence");
      if (permissionMode !== "default") {
        const mode =
          permissionMode === "bypass"
            ? "bypassPermissions"
            : permissionMode === "plan" || permissionMode === "auto"
              ? permissionMode
              : undefined;
        if (mode) args.push("--permission-mode", mode);
      }
      args.push("-p", "--output-format", "json");
      if (target.model) args.push("--model", target.model);
      if (target.variant) args.push("--effort", target.variant);
      if (target.agent) args.push("--agent", target.agent);
      args.push(...(target.extraArgs ?? []));
      return args;
    case "cursor":
      args.push(
        "-c",
        [
          "set -eu",
          "if command -v agent >/dev/null 2>&1; then",
          "  exec agent \"$@\"",
          "elif command -v cursor >/dev/null 2>&1; then",
          "  exec cursor agent \"$@\"",
          "else",
          "  echo 'Executable not found in PATH: cursor agent or agent' >&2",
          "  exit 127",
          "fi",
        ].join("\n"),
        "openloops-cursor",
        "-p",
      );
      if (permissionMode === "plan") args.push("--mode", "plan");
      if (permissionMode === "bypass") args.push("--force");
      const cursorSandbox = target.sandbox ?? (isolation === "safe" ? "enabled" : undefined);
      if (cursorSandbox) {
        if (cursorSandbox !== "enabled" && cursorSandbox !== "disabled") throw new Error("cursor sandbox must be enabled or disabled");
        args.push("--sandbox", cursorSandbox);
      }
      if (target.model) args.push("--model", target.model);
      if (target.agent) args.push("--agent", target.agent);
      args.push(...(target.extraArgs ?? []));
      return args;
    case "codewith":
      args.push(...(target.authProfile ? ["--auth-profile", target.authProfile] : []));
      if (target.variant) args.push("-c", `model_reasoning_effort=${configStringValue(target.variant)}`);
      args.push(
        "--ask-for-approval",
        "never",
        "exec",
        "--json",
        "--ephemeral",
        "--sandbox",
        codewithLikeSandbox(target),
        "--skip-git-repo-check",
      );
      if (isolation === "safe") args.push("--ignore-rules");
      if (target.cwd) args.push("--cd", target.cwd);
      for (const dir of target.addDirs ?? []) args.push("--add-dir", dir);
      if (target.model) args.push("--model", target.model);
      if (target.agent) args.push("--agent", target.agent);
      args.push(...(target.extraArgs ?? []));
      return args;
    case "codex":
      if (target.variant) args.push("-c", `model_reasoning_effort=${configStringValue(target.variant)}`);
      args.push("exec", "--json", "--ephemeral", "--sandbox", codewithLikeSandbox(target), "--skip-git-repo-check");
      if (isolation === "safe") args.push("--ignore-rules");
      if (target.cwd) args.push("--cd", target.cwd);
      for (const dir of target.addDirs ?? []) args.push("--add-dir", dir);
      if (target.model) args.push("--model", target.model);
      args.push(...(target.extraArgs ?? []));
      return args;
    case "aicopilot":
      args.push("run", "--format", "json");
      if (isolation === "safe") args.push("--pure");
      if (permissionMode === "bypass") args.push("--dangerously-skip-permissions");
      if (target.cwd) args.push("--dir", target.cwd);
      if (target.model) args.push("--model", target.model);
      if (target.variant) args.push("--variant", target.variant);
      if (target.agent) args.push("--agent", target.agent);
      args.push(...(target.extraArgs ?? []));
      return args;
    case "opencode":
      args.push("run", "--format", "json");
      if (isolation === "safe") args.push("--pure");
      if (permissionMode === "bypass") args.push("--dangerously-skip-permissions");
      if (target.cwd) args.push("--dir", target.cwd);
      if (target.model) args.push("--model", target.model);
      if (target.variant) args.push("--variant", target.variant);
      if (target.agent) args.push("--agent", target.agent);
      args.push(...(target.extraArgs ?? []));
      return args;
  }
}

function commandSpec(target: ExecutableTarget): CommandSpec {
  if (target.type === "command") {
    const commandTarget = target as CommandTarget;
    return {
      command: commandTarget.command,
      args: commandTarget.args ?? [],
      cwd: commandTarget.cwd,
      shell: commandTarget.shell,
      env: commandTarget.env,
      timeoutMs: commandTarget.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      idleTimeoutMs: commandTarget.idleTimeoutMs,
      account: commandTarget.account,
      accountTool: commandTarget.account?.tool,
    };
  }
  const agentTarget = target as AgentTarget;
  return {
    command: providerCommand(agentTarget.provider),
    args: agentArgs(agentTarget),
    cwd: agentTarget.cwd,
    timeoutMs: agentTarget.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    idleTimeoutMs: agentTarget.idleTimeoutMs,
    account: agentTarget.account,
    accountTool: agentTarget.account?.tool ?? accountToolForProvider(agentTarget.provider),
    nativeAuthProfile: agentTarget.authProfile
      ? { provider: agentTarget.provider, profile: agentTarget.authProfile }
      : undefined,
    preflightAnyOf: agentTarget.provider === "cursor" ? ["cursor", "agent"] : undefined,
    stdin: agentTarget.prompt,
    allowlist: agentTarget.allowlist,
  };
}

function executionEnv(
  spec: CommandSpec,
  metadata: ExecutionMetadata,
  opts: ExecuteOptions,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env) };
  if (spec.account) {
    const accountEnv = resolveAccountEnv(spec.account, spec.accountTool, env);
    for (const key of AUTH_ENV_KEYS) delete env[key];
    Object.assign(env, accountEnv);
  }
  Object.assign(env, spec.env ?? {});
  Object.assign(env, allowlistEnv(spec.allowlist));
  env.PATH = normalizeExecutionPath(env);
  Object.assign(env, metadataEnv(metadata));
  return env;
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

function remoteBootstrapLines(spec: CommandSpec, metadata: ExecutionMetadata): string[] {
  const lines: string[] = [
    "set -e",
    'export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.npm-global/bin:$HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin${PATH:+:$PATH}"',
  ];
  if (spec.cwd) lines.push(`cd ${shellQuote(spec.cwd)}`);
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

function remoteScript(spec: CommandSpec, metadata: ExecutionMetadata): string {
  const lines = remoteBootstrapLines(spec, metadata);

  let stdinRedirect = "";
  if (spec.stdin !== undefined) {
    lines.push('__OPENLOOPS_STDIN="$(mktemp -t openloops-stdin.XXXXXX)"', 'trap \'rm -f "$__OPENLOOPS_STDIN"\' EXIT');
    lines.push(...hereDoc(spec.stdin));
    stdinRedirect = ' < "$__OPENLOOPS_STDIN"';
  }

  const invocation = spec.shell
    ? `sh -c ${shellQuote(commandForShell(spec))}${stdinRedirect}`
    : `${[spec.command, ...spec.args].map(shellQuote).join(" ")}${stdinRedirect}`;
  lines.push(invocation);
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

function preflightNativeAuthProfile(spec: CommandSpec, env: NodeJS.ProcessEnv): void {
  if (!spec.nativeAuthProfile) return;
  if (spec.nativeAuthProfile.provider !== "codewith") return;
  const result = spawnSync(spec.command, ["profile", "list"], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  });
  if (result.error) {
    throw new Error(`codewith auth profile preflight failed: ${result.error.message}`);
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
  if (!profiles.has(spec.nativeAuthProfile.profile)) {
    throw new Error(`codewith auth profile not found: ${spec.nativeAuthProfile.profile}`);
  }
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
): Promise<ExecutorResult> {
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedAt = nowIso();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let idleTimedOut = false;
  let exitCode: number | undefined;
  let error: string | undefined;
  let plan: MachineCommandPlan;
  let script: string;

  try {
    plan = (opts.machineCommandResolver ?? resolveMachineCommand)(machine.id, "bash -s");
    script = remoteScript(spec, metadata);
  } catch (err) {
    return {
      status: "failed",
      stdout: "",
      stderr: "",
      error: err instanceof Error ? err.message : String(err),
      startedAt,
      finishedAt: nowIso(),
      durationMs: 0,
    };
  }

  const child = spawn(plan.command, plan.args, {
    env: transportEnv(opts),
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (child.pid) opts.onSpawn?.(child.pid);

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

  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid) killProcessGroup(child.pid);
  }, spec.timeoutMs);
  timer.unref();
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

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout = appendBounded(stdout, chunk, maxOutputBytes);
    resetIdleTimer();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = appendBounded(stderr, chunk, maxOutputBytes);
    resetIdleTimer();
  });

  try {
    const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
    if (typeof code === "number") exitCode = code;
    if (signal) error = `terminated by ${signal}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
    if (idleTimer) clearTimeout(idleTimer);
    opts.signal?.removeEventListener("abort", abortHandler);
  }

  const finishedAt = nowIso();
  const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (timedOut || idleTimedOut) {
    return {
      status: "timed_out",
      exitCode,
      stdout,
      stderr,
      error: idleTimedOut ? `idle timed out after ${spec.idleTimeoutMs}ms without stdout/stderr` : `timed out after ${spec.timeoutMs}ms`,
      pid: child.pid,
      startedAt,
      finishedAt,
      durationMs,
    };
  }
  if (error || exitCode !== 0) {
    return {
      status: "failed",
      exitCode,
      stdout,
      stderr,
      error: error ?? `remote process on ${machine.id} exited with code ${exitCode ?? "unknown"}`,
      pid: child.pid,
      startedAt,
      finishedAt,
      durationMs,
    };
  }
  return {
    status: "succeeded",
    exitCode,
    stdout,
    stderr,
    pid: child.pid,
    startedAt,
    finishedAt,
    durationMs,
  };
}

export function preflightTarget(
  target: ExecutableTarget,
  metadata: ExecutionMetadata = {},
  opts: ExecuteOptions = {},
): PreflightResult {
  const spec = commandSpec(target);
  const machine = resolvedMachine(opts);
  if (machine && !machine.local) {
    preflightRemoteSpec(spec, machine, metadata, opts);
    return {
      command: spec.command,
      accountProfile: spec.account?.profile,
      accountTool: spec.accountTool,
    };
  }
  const env = executionEnv(spec, metadata, opts);
  if (!spec.shell && !executableExists(spec.command, env)) {
    throw new Error(commandNotFoundMessage(spec.command, env));
  }
  if (spec.preflightAnyOf?.length && !spec.preflightAnyOf.some((command) => executableExists(command, env))) {
    throw new Error(`none of required executables found: ${spec.preflightAnyOf.join(", ")}`);
  }
  preflightNativeAuthProfile(spec, env);
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
  const spec = commandSpec(target);
  const machine = resolvedMachine(opts);
  if (machine && !machine.local) return executeRemoteSpec(spec, machine, metadata, opts);
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedAt = nowIso();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let idleTimedOut = false;
  let exitCode: number | undefined;
  let error: string | undefined;

  const env = executionEnv(spec, metadata, opts);
  if (!spec.shell && !executableExists(spec.command, env)) {
    return {
      status: "failed",
      stdout: "",
      stderr: "",
      error: commandNotFoundMessage(spec.command, env),
      startedAt,
      finishedAt: nowIso(),
      durationMs: 0,
    };
  }
  if (spec.preflightAnyOf?.length && !spec.preflightAnyOf.some((command) => executableExists(command, env))) {
    return {
      status: "failed",
      stdout,
      stderr,
      error: `none of required executables found: ${spec.preflightAnyOf.join(", ")}`,
      startedAt,
      finishedAt: nowIso(),
      durationMs: 0,
    };
  }
  try {
    preflightNativeAuthProfile(spec, env);
  } catch (err) {
    return {
      status: "failed",
      stdout: "",
      stderr: "",
      error: err instanceof Error ? err.message : String(err),
      startedAt,
      finishedAt: nowIso(),
      durationMs: 0,
    };
  }

  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env,
    shell: spec.shell ?? false,
    detached: true,
    stdio: spec.stdin === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
  });
  if (child.pid) opts.onSpawn?.(child.pid);

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

  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid) killProcessGroup(child.pid);
  }, spec.timeoutMs);
  timer.unref();
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

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout = appendBounded(stdout, chunk, maxOutputBytes);
    resetIdleTimer();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = appendBounded(stderr, chunk, maxOutputBytes);
    resetIdleTimer();
  });

  try {
    const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
    if (typeof code === "number") exitCode = code;
    if (signal) error = `terminated by ${signal}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
    if (idleTimer) clearTimeout(idleTimer);
    opts.signal?.removeEventListener("abort", abortHandler);
  }

  const finishedAt = nowIso();
  const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (timedOut || idleTimedOut) {
    return {
      status: "timed_out",
      exitCode,
      stdout,
      stderr,
      error: idleTimedOut ? `idle timed out after ${spec.idleTimeoutMs}ms without stdout/stderr` : `timed out after ${spec.timeoutMs}ms`,
      pid: child.pid,
      startedAt,
      finishedAt,
      durationMs,
    };
  }
  if (error || exitCode !== 0) {
    return {
      status: "failed",
      exitCode,
      stdout,
      stderr,
      error: error ?? `process exited with code ${exitCode ?? "unknown"}`,
      pid: child.pid,
      startedAt,
      finishedAt,
      durationMs,
    };
  }
  return {
    status: "succeeded",
    exitCode,
    stdout,
    stderr,
    pid: child.pid,
    startedAt,
    finishedAt,
    durationMs,
  };
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
      const finishedAt = nowIso();
      return {
        status: "failed",
        stdout: "",
        stderr: "",
        error: `runtime preflight failed: ${error instanceof Error ? error.message : String(error)}`,
        startedAt,
        finishedAt,
        durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      };
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
