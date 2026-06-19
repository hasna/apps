import { spawn } from "node:child_process";
import { once } from "node:events";
import type { AgentProvider, AgentTarget, CommandTarget, ExecutorResult, Loop, LoopRun } from "../types.js";
import { nowIso } from "./ids.js";

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

export interface ExecuteOptions {
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

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

function commandSpec(loop: Loop): {
  command: string;
  args: string[];
  cwd?: string;
  shell?: boolean;
  env?: Record<string, string>;
  timeoutMs: number;
} {
  const target = loop.target;
  if (target.type === "command") {
    const commandTarget = target as CommandTarget;
    return {
      command: commandTarget.command,
      args: commandTarget.args ?? [],
      cwd: commandTarget.cwd,
      shell: commandTarget.shell,
      env: commandTarget.env,
      timeoutMs: commandTarget.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }
  const agentTarget = target as AgentTarget;
  return {
    command: providerCommand(agentTarget.provider),
    args: agentArgs(agentTarget),
    cwd: agentTarget.cwd,
    timeoutMs: agentTarget.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

export async function executeLoop(loop: Loop, run: LoopRun, opts: ExecuteOptions = {}): Promise<ExecutorResult> {
  const spec = commandSpec(loop);
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedAt = nowIso();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let exitCode: number | undefined;
  let error: string | undefined;

  const env = {
    ...(opts.env ?? process.env),
    ...(spec.env ?? {}),
    LOOPS_LOOP_ID: loop.id,
    LOOPS_LOOP_NAME: loop.name,
    LOOPS_RUN_ID: run.id,
    LOOPS_SCHEDULED_FOR: run.scheduledFor,
  };

  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env,
    shell: spec.shell ?? false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

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
