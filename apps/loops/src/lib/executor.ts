import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { resolveMachineCommand } from "@hasna/machines/consumer";
import type { LanguageModel } from "ai";
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
  goalModel?: LanguageModel;
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

function appendBounded(current: string, chunk: Buffer, maxBytes: number): string {
  const next = current + chunk.toString("utf8");
  if (Buffer.byteLength(next, "utf8") <= maxBytes) return next;
  const overflow = Buffer.byteLength(next, "utf8") - maxBytes;
  return `[truncated ${overflow} bytes]\n${next.slice(-maxBytes)}`;
}

function appendBoundedText(current: string, chunk: string, maxBytes: number): string {
  return appendBounded(current, Buffer.from(chunk, "utf8"), maxBytes);
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

const UNSAFE_CODEWITH_DURABLE_EXTRA_ARGS = new Set([
  "e",
  "exec",
  "agent",
  "start",
  "--ephemeral",
  "--ignore-rules",
  "--skip-git-repo-check",
  "--json",
  "--output-last-message",
  "-o",
  "--output-schema",
  "--dangerously-bypass-approvals-and-sandbox",
]);

function assertStringOption(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== "string") throw new Error(`${label} must be a string`);
}

function assertSupportedAgentOptions(target: AgentTarget): void {
  assertStringOption(target.variant, `${target.provider}.variant`);
  assertStringOption(target.model, `${target.provider}.model`);
  assertStringOption(target.agent, `${target.provider}.agent`);
  assertStringOption(target.authProfile, `${target.provider}.authProfile`);
  assertStringOption(target.configIsolation, `${target.provider}.configIsolation`);
  if (target.provider === "opencode" && (target.model === undefined || target.model.trim() === "")) {
    throw new Error("opencode.model is required; pass a provider/model id such as openrouter/google/gemini-2.5-flash");
  }
  if (target.configIsolation !== undefined && target.configIsolation !== "safe" && target.configIsolation !== "none") {
    throw new Error(`${target.provider}.configIsolation must be safe or none`);
  }
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
  if (target.provider === "codex" && target.agent !== undefined) throw new Error("codex.agent is not supported");
  if (target.provider === "codewith" && target.agent !== undefined) {
    throw new Error("codewith.agent is not supported by the durable background-agent adapter");
  }
  if (target.provider === "codewith") {
    const unsafe = target.extraArgs?.find((arg) => UNSAFE_CODEWITH_DURABLE_EXTRA_ARGS.has(arg));
    if (unsafe) throw new Error(`codewith.extraArgs cannot include ${unsafe}; durable agent steps use codewith agent start, not exec/ephemeral flags`);
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
    if (target.variant !== undefined) throw new Error("cursor.variant is not supported");
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
          "else",
          "  echo 'Executable not found in PATH: agent' >&2",
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
      args.push("--ask-for-approval", "never", "--sandbox", codewithLikeSandbox(target));
      if (target.cwd) args.push("--cd", target.cwd);
      for (const dir of target.addDirs ?? []) args.push("--add-dir", dir);
      if (target.model) args.push("--model", target.model);
      args.push(...(target.extraArgs ?? []));
      args.push("agent", "start");
      if (target.cwd) args.push("--cwd", target.cwd);
      args.push(target.prompt);
      return args;
    case "codex":
      if (target.variant) args.push("-c", `model_reasoning_effort=${configStringValue(target.variant)}`);
      args.push("--ask-for-approval", "never", "exec", "--json", "--ephemeral", "--sandbox", codewithLikeSandbox(target), "--skip-git-repo-check");
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
      timeoutMs: commandTarget.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : commandTarget.timeoutMs,
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
    timeoutMs: agentTarget.timeoutMs ?? null,
    idleTimeoutMs: agentTarget.idleTimeoutMs,
    account: agentTarget.account,
    accountTool: agentTarget.account?.tool ?? accountToolForProvider(agentTarget.provider),
    nativeAuthProfile: agentTarget.authProfile
      ? { provider: agentTarget.provider, profile: agentTarget.authProfile }
      : undefined,
    preflightAnyOf: agentTarget.provider === "cursor" ? ["agent"] : undefined,
    stdin: agentTarget.provider === "codewith" ? undefined : agentTarget.prompt,
    allowlist: agentTarget.allowlist,
    codewithDurableAgent: agentTarget.provider === "codewith" ? { target: agentTarget } : undefined,
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

function codewithAgentStartArgs(target: AgentTarget, idempotencyKey: string): string[] {
  const args = agentArgs(target);
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
  const start = spawnSync(spec.command, codewithAgentStartArgs(target, idempotencyKey), {
    cwd: spec.cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  let stderr = start.stderr || "";
  if (start.error || (start.status ?? 1) !== 0) {
    const finishedAt = nowIso();
    return {
      status: "failed",
      exitCode: start.status ?? undefined,
      stdout: start.stdout || "",
      stderr,
      error: start.error?.message ?? `codewith agent start exited with code ${start.status ?? "unknown"}`,
      startedAt,
      finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    };
  }
  let startJson: Record<string, unknown>;
  try {
    startJson = parseJsonOutput(start.stdout || "{}", "codewith agent start");
  } catch (error) {
    const finishedAt = nowIso();
    return {
      status: "failed",
      stdout: start.stdout || "",
      stderr,
      error: error instanceof Error ? error.message : String(error),
      startedAt,
      finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    };
  }
  const agentId = stringField(recordField(startJson, "agent"), "agentId");
  if (!agentId) {
    const finishedAt = nowIso();
    return {
      status: "failed",
      stdout: start.stdout || "",
      stderr,
      error: "codewith agent start did not return agent.agentId",
      startedAt,
      finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    };
  }

  const pollMs = Math.max(100, Number(opts.env?.LOOPS_CODEWITH_AGENT_POLL_MS ?? process.env.LOOPS_CODEWITH_AGENT_POLL_MS ?? 2_000) || 2_000);
  let lastReadJson = startJson;
  let lastLogsJson: Record<string, unknown> | undefined;
  let stdout = "";
  while (true) {
    if (opts.signal?.aborted) {
      spawnSync(spec.command, codewithAgentControlArgs(target, "stop", agentId), { cwd: spec.cwd, env, stdio: "ignore", timeout: 15_000 });
      const finishedAt = nowIso();
      return {
        status: "failed",
        stdout: appendBoundedText(stdout, codewithAgentEvidence(startJson, lastReadJson, lastLogsJson), maxOutputBytes),
        stderr,
        error: "cancelled",
        startedAt,
        finishedAt,
        durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      };
    }

    const read = spawnSync(spec.command, codewithAgentControlArgs(target, "read", agentId), {
      cwd: spec.cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    stderr = appendBoundedText(stderr, read.stderr || "", maxOutputBytes);
    if (read.error || (read.status ?? 1) !== 0) {
      const finishedAt = nowIso();
      return {
        status: "failed",
        exitCode: read.status ?? undefined,
        stdout: appendBoundedText(stdout, codewithAgentEvidence(startJson, lastReadJson, lastLogsJson), maxOutputBytes),
        stderr,
        error: read.error?.message ?? `codewith agent read exited with code ${read.status ?? "unknown"}`,
        startedAt,
        finishedAt,
        durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      };
    }
    try {
      lastReadJson = parseJsonOutput(read.stdout || "{}", "codewith agent read");
    } catch (error) {
      const finishedAt = nowIso();
      return {
        status: "failed",
        stdout: appendBoundedText(stdout, read.stdout || "", maxOutputBytes),
        stderr,
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        finishedAt,
        durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      };
    }

    const status = codewithAgentStatus(lastReadJson);
    if (status === "completed" || status === "failed" || status === "cancelled") {
      const logs = spawnSync(spec.command, codewithAgentControlArgs(target, "logs", agentId), {
        cwd: spec.cwd,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      });
      if (!logs.error && (logs.status ?? 1) === 0) {
        try {
          lastLogsJson = parseJsonOutput(logs.stdout || "{}", "codewith agent logs");
        } catch {
          lastLogsJson = undefined;
        }
      } else {
        stderr = appendBoundedText(stderr, logs.stderr || logs.error?.message || "", maxOutputBytes);
      }
      const finishedAt = nowIso();
      const resultStatus = status === "completed" ? "succeeded" : "failed";
      return {
        status: resultStatus,
        exitCode: resultStatus === "succeeded" ? 0 : 1,
        stdout: appendBoundedText(stdout, codewithAgentEvidence(startJson, lastReadJson, lastLogsJson), maxOutputBytes),
        stderr,
        error: resultStatus === "succeeded" ? undefined : stringField(recordField(lastReadJson, "agent"), "statusReason") ?? `codewith agent ${status}`,
        startedAt,
        finishedAt,
        durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      };
    }

    if (typeof spec.timeoutMs === "number" && new Date(nowIso()).getTime() - new Date(startedAt).getTime() >= spec.timeoutMs) {
      spawnSync(spec.command, codewithAgentControlArgs(target, "stop", agentId), { cwd: spec.cwd, env, stdio: "ignore", timeout: 15_000 });
      const finishedAt = nowIso();
      return {
        status: "timed_out",
        stdout: appendBoundedText(stdout, codewithAgentEvidence(startJson, lastReadJson, lastLogsJson), maxOutputBytes),
        stderr,
        error: `timed out after ${spec.timeoutMs}ms`,
        startedAt,
        finishedAt,
        durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      };
    }
    await sleep(pollMs);
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
    if (timer) clearTimeout(timer);
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
  if (machine && !machine.local && spec.codewithDurableAgent) {
    const startedAt = nowIso();
    const finishedAt = nowIso();
    return {
      status: "failed",
      stdout: "",
      stderr: "",
      error: "remote Codewith durable background-agent steps require remote status polling support; run this Codewith step locally or add remote durable readback before dispatch",
      startedAt,
      finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    };
  }
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
    if (timer) clearTimeout(timer);
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
