import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import type { AccountRef, AgentProvider, AgentTarget, CommandTarget, ExecutableTarget, ExecutorResult, Loop, LoopRun } from "../types.js";
import { accountToolForProvider, resolveAccountEnv } from "./accounts.js";
import { nowIso } from "./ids.js";

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

export interface ExecuteOptions {
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  signal?: AbortSignal;
  onSpawn?: (pid: number) => void;
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
}

export interface PreflightResult {
  command: string;
  accountProfile?: string;
  accountTool?: string;
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

function providerCommand(provider: AgentProvider): string {
  switch (provider) {
    case "claude":
      return "claude";
    case "cursor":
      return "cursor-agent";
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

function agentArgs(target: AgentTarget): string[] {
  const isolation = target.configIsolation ?? "safe";
  const args: string[] = [];
  switch (target.provider) {
    case "claude":
      if (isolation === "safe") args.push("--safe-mode", "--setting-sources", "local", "--no-session-persistence");
      args.push("-p", "--output-format", "json");
      if (target.model) args.push("--model", target.model);
      if (target.agent) args.push("--agent", target.agent);
      args.push(...(target.extraArgs ?? []), target.prompt);
      return args;
    case "cursor":
      args.push("-p");
      if (target.model) args.push("--model", target.model);
      if (target.agent) args.push("--agent", target.agent);
      args.push(...(target.extraArgs ?? []), target.prompt);
      return args;
    case "codewith":
      args.push("exec", "--json", "--ephemeral", "--ask-for-approval", "never", "--sandbox", "workspace-write");
      if (isolation === "safe") args.push("--ignore-rules");
      if (target.cwd) args.push("--cd", target.cwd);
      if (target.model) args.push("--model", target.model);
      if (target.agent) args.push("--agent", target.agent);
      args.push(...(target.extraArgs ?? []), target.prompt);
      return args;
    case "codex":
      args.push("exec", "--json", "--ephemeral", "--ask-for-approval", "never", "--sandbox", "workspace-write");
      if (isolation === "safe") args.push("--ignore-rules");
      if (target.cwd) args.push("--cd", target.cwd);
      if (target.model) args.push("--model", target.model);
      args.push(...(target.extraArgs ?? []), target.prompt);
      return args;
    case "aicopilot":
      args.push("run", "--format", "json");
      if (isolation === "safe") args.push("--pure");
      if (target.cwd) args.push("--dir", target.cwd);
      if (target.model) args.push("--model", target.model);
      if (target.agent) args.push("--agent", target.agent);
      args.push(...(target.extraArgs ?? []), target.prompt);
      return args;
    case "opencode":
      args.push("run", "--format", "json");
      if (isolation === "safe") args.push("--pure");
      if (target.cwd) args.push("--dir", target.cwd);
      if (target.model) args.push("--model", target.model);
      if (target.agent) args.push("--agent", target.agent);
      args.push(...(target.extraArgs ?? []), target.prompt);
      return args;
  }
}

function commandSpec(target: ExecutableTarget): {
  command: string;
  args: string[];
  cwd?: string;
  shell?: boolean;
  env?: Record<string, string>;
  timeoutMs: number;
  account?: AccountRef;
  accountTool?: string;
} {
  if (target.type === "command") {
    const commandTarget = target as CommandTarget;
    return {
      command: commandTarget.command,
      args: commandTarget.args ?? [],
      cwd: commandTarget.cwd,
      shell: commandTarget.shell,
      env: commandTarget.env,
      timeoutMs: commandTarget.timeoutMs ?? DEFAULT_TIMEOUT_MS,
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
    account: agentTarget.account,
    accountTool: agentTarget.account?.tool ?? accountToolForProvider(agentTarget.provider),
  };
}

function executionEnv(
  spec: ReturnType<typeof commandSpec>,
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
  if (metadata.loopId) env.LOOPS_LOOP_ID = metadata.loopId;
  if (metadata.loopName) env.LOOPS_LOOP_NAME = metadata.loopName;
  if (metadata.runId) env.LOOPS_RUN_ID = metadata.runId;
  if (metadata.scheduledFor) env.LOOPS_SCHEDULED_FOR = metadata.scheduledFor;
  if (metadata.workflowId) env.LOOPS_WORKFLOW_ID = metadata.workflowId;
  if (metadata.workflowName) env.LOOPS_WORKFLOW_NAME = metadata.workflowName;
  if (metadata.workflowRunId) env.LOOPS_WORKFLOW_RUN_ID = metadata.workflowRunId;
  if (metadata.workflowStepId) env.LOOPS_WORKFLOW_STEP_ID = metadata.workflowStepId;
  return env;
}

function commandExists(command: string, env: NodeJS.ProcessEnv): boolean {
  if (command.includes("/") && existsSync(command)) return true;
  const result = spawnSync("sh", ["-c", "command -v \"$1\" >/dev/null", "sh", command], {
    env,
    stdio: "ignore",
  });
  return (result.status ?? 1) === 0;
}

export function preflightTarget(
  target: ExecutableTarget,
  metadata: ExecutionMetadata = {},
  opts: ExecuteOptions = {},
): PreflightResult {
  const spec = commandSpec(target);
  const env = executionEnv(spec, metadata, opts);
  if (!spec.shell && !commandExists(spec.command, env)) {
    throw new Error(`Executable not found in PATH: ${spec.command}`);
  }
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
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedAt = nowIso();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let exitCode: number | undefined;
  let error: string | undefined;

  const env = executionEnv(spec, metadata, opts);
  if (!spec.shell && !commandExists(spec.command, env)) {
    return {
      status: "failed",
      stdout: "",
      stderr: "",
      error: `Executable not found in PATH: ${spec.command}`,
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
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.pid) opts.onSpawn?.(child.pid);

  const abortHandler = (): void => {
    error = "cancelled";
    if (child.pid) killProcessGroup(child.pid);
  };
  if (opts.signal?.aborted) abortHandler();
  opts.signal?.addEventListener("abort", abortHandler, { once: true });

  child.stdout.on("data", (chunk: Buffer) => {
    stdout = appendBounded(stdout, chunk, maxOutputBytes);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = appendBounded(stderr, chunk, maxOutputBytes);
  });

  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid) killProcessGroup(child.pid);
  }, spec.timeoutMs);
  timer.unref();

  try {
    const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
    if (typeof code === "number") exitCode = code;
    if (signal) error = `terminated by ${signal}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", abortHandler);
  }

  const finishedAt = nowIso();
  const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (timedOut) {
    return {
      status: "timed_out",
      exitCode,
      stdout,
      stderr,
      error: `timed out after ${spec.timeoutMs}ms`,
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
  return executeTarget(
    loop.target,
    {
      loopId: loop.id,
      loopName: loop.name,
      runId: run.id,
      scheduledFor: run.scheduledFor,
    },
    opts,
  );
}
