import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { getLocalMachineId } from "./db.js";
import { buildSshCommandPlan, validateSshTarget } from "./commands/ssh.js";

export interface MachineCommandResult {
  machineId: string;
  source: "local" | "lan" | "tailscale" | "ssh";
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  signal?: NodeJS.Signals | null;
}

export interface MachineCommandOptions {
  timeoutMs?: number;
  killGraceMs?: number;
}

export interface ResolvedMachineCommand {
  source: MachineCommandResult["source"];
  command: string;
  args: string[];
  shellCommand: string;
  usesShell: boolean;
}

export type MachineCommandRunner = (machineId: string, command: string, options?: MachineCommandOptions) => MachineCommandResult;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function machineIsLocal(machineId: string, localMachineId: string): boolean {
  return machineId === "local"
    || machineId === "localhost"
    || machineId === localMachineId
    || machineId === hostname();
}

export function resolveMachineCommand(machineId: string, command: string, localMachineId = getLocalMachineId()): ResolvedMachineCommand {
  if (machineIsLocal(machineId, localMachineId)) {
    return { source: "local", command: "bash", args: ["-c", command], shellCommand: command, usesShell: true };
  }

  try {
    const plan = buildSshCommandPlan(machineId, command);
    return {
      source: plan.route,
      command: plan.command,
      args: plan.args,
      shellCommand: plan.shellCommand,
      usesShell: false,
    };
  } catch (error) {
    const message = String((error as Error).message ?? error);
    if (message.includes("Machine route not found") || message.includes("Machine not found in manifest")) {
      const target = validateSshTarget(machineId);
      return {
        source: "ssh",
        command: "ssh",
        args: [target, command],
        shellCommand: `ssh ${shellQuote(target)} ${shellQuote(command)}`,
        usesShell: false,
      };
    }
    throw error;
  }
}

export function runMachineCommand(machineId: string, command: string, options: MachineCommandOptions = {}): MachineCommandResult {
  const resolved = resolveMachineCommand(machineId, command);
  return runResolvedMachineCommand(machineId, resolved, options);
}

export function runResolvedMachineCommand(
  machineId: string,
  resolved: ResolvedMachineCommand,
  options: MachineCommandOptions = {},
): MachineCommandResult {
  if (options.timeoutMs && options.timeoutMs > 0 && process.platform !== "win32") {
    return runMachineCommandWithProcessGroupTimeout(machineId, resolved, options);
  }
  const result = spawnSync(resolved.command, resolved.args, {
    encoding: "utf8",
    env: process.env,
    timeout: options.timeoutMs,
    killSignal: "SIGTERM",
  });
  const timedOut = Boolean(result.error && "code" in result.error && result.error.code === "ETIMEDOUT");
  const timeoutMessage = timedOut ? `Command timed out after ${options.timeoutMs}ms.` : "";
  const stderr = [result.stderr || "", timeoutMessage].filter(Boolean).join(result.stderr ? "\n" : "");

  return {
    machineId,
    source: resolved.source,
    stdout: result.stdout || "",
    stderr,
    exitCode: timedOut ? 124 : result.status ?? 1,
    timedOut,
    signal: result.signal,
  };
}

function runMachineCommandWithProcessGroupTimeout(
  machineId: string,
  resolved: ResolvedMachineCommand,
  options: MachineCommandOptions,
): MachineCommandResult {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 1);
  const killGraceMs = Math.max(1, options.killGraceMs ?? 1_000);
  const helperDir = mkdtempSync(join(tmpdir(), "machines-timeout-helper-"));
  const pgidFile = join(helperDir, "pgid");
  const helper = spawnSync(process.execPath, ["--eval", PROCESS_GROUP_TIMEOUT_HELPER], {
    input: JSON.stringify({ command: resolved.command, args: resolved.args }),
    encoding: "utf8",
    env: {
      ...process.env,
      HASNA_MACHINES_COMMAND_TIMEOUT_MS: String(timeoutMs),
      HASNA_MACHINES_COMMAND_KILL_GRACE_MS: String(killGraceMs),
      HASNA_MACHINES_COMMAND_PGID_FILE: pgidFile,
    },
    timeout: timeoutMs + killGraceMs + 2_000,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
  });

  try {
    const parsed = parseHelperResult(helper.stdout);
    if (parsed) {
      return {
        machineId,
        source: resolved.source,
        stdout: parsed.stdout,
        stderr: parsed.stderr,
        exitCode: parsed.exitCode,
        timedOut: parsed.timedOut,
        signal: parsed.signal,
      };
    }

    const helperTimedOut = Boolean(helper.error && "code" in helper.error && helper.error.code === "ETIMEDOUT");
    if (helperTimedOut) killPublishedProcessGroup(pgidFile);
    const timeoutMessage = helperTimedOut ? `Command timed out after ${timeoutMs}ms; timeout helper exceeded cleanup grace ${killGraceMs}ms.` : "";
    const stderr = [helper.stderr || "", timeoutMessage].filter(Boolean).join(helper.stderr ? "\n" : "");
    return {
      machineId,
      source: resolved.source,
      stdout: "",
      stderr,
      exitCode: helperTimedOut ? 124 : helper.status ?? 1,
      timedOut: helperTimedOut,
      signal: helper.signal,
    };
  } finally {
    rmSync(helperDir, { recursive: true, force: true });
  }
}

function killPublishedProcessGroup(pgidFile: string): void {
  if (!existsSync(pgidFile)) return;
  try {
    const pid = Number.parseInt(readFileSync(pgidFile, "utf8").trim(), 10);
    if (!Number.isInteger(pid) || pid <= 1) return;
    process.kill(-pid, "SIGKILL");
  } catch {}
}

function parseHelperResult(stdout: string | null | undefined): MachineCommandResult | null {
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout) as Partial<MachineCommandResult>;
    if (typeof parsed.stdout !== "string" || typeof parsed.stderr !== "string" || typeof parsed.exitCode !== "number") return null;
    return {
      machineId: "",
      source: "local",
      stdout: parsed.stdout,
      stderr: parsed.stderr,
      exitCode: parsed.exitCode,
      timedOut: parsed.timedOut === true,
      signal: typeof parsed.signal === "string" ? parsed.signal as NodeJS.Signals : null,
    };
  } catch {
    return null;
  }
}

const PROCESS_GROUP_TIMEOUT_HELPER = `
	const { spawn } = require("node:child_process");
	const { readFileSync, writeFileSync } = require("node:fs");

	const plan = JSON.parse(readFileSync(0, "utf8"));
	const command = String(plan.command || "");
	const args = Array.isArray(plan.args) ? plan.args.map(String) : [];
	const timeoutMs = Math.max(1, Number.parseInt(process.env.HASNA_MACHINES_COMMAND_TIMEOUT_MS || "1", 10));
	const killGraceMs = Math.max(1, Number.parseInt(process.env.HASNA_MACHINES_COMMAND_KILL_GRACE_MS || "1000", 10));
	const pgidFile = process.env.HASNA_MACHINES_COMMAND_PGID_FILE || "";
	let stdout = "";
	let stderr = "";
	let timedOut = false;
	let finished = false;
let timeoutTimer;
let killTimer;
let sigkillSent = false;
let pendingExit = null;

const child = spawn(command, args, {
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
	  env: process.env,
	});

	if (pgidFile && child.pid) {
	  try {
	    writeFileSync(pgidFile, String(child.pid), { mode: 0o600 });
	  } catch {}
	}

function appendText(target, chunk) {
  return target + String(chunk);
}

	function killTarget(signal) {
	  if (!child.pid) return;
	  if (process.platform === "win32") {
	    try {
	      process.kill(child.pid, signal);
	    } catch {}
	    return;
	  }
	  try {
	    process.kill(-child.pid, signal);
	  } catch {}
	}

	function finish(code, signal) {
	  if (finished) return;
  if (timedOut && !sigkillSent) {
    pendingExit = { code, signal };
    return;
  }
  finished = true;
  if (timeoutTimer) clearTimeout(timeoutTimer);
  if (killTimer) clearTimeout(killTimer);
	  if (timedOut) {
	    stderr = [stderr, "Command timed out after " + timeoutMs + "ms."].filter(Boolean).join(stderr ? "\\n" : "");
	  }
	  const exitCode = timedOut ? 124 : code ?? 1;
	  process.stdout.write(JSON.stringify({
	    stdout,
	    stderr,
	    exitCode,
	    timedOut,
	    signal: signal ?? null,
	  }), () => process.exit(exitCode));
	}

	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => { stdout = appendText(stdout, chunk); });
	child.stderr.on("data", (chunk) => { stderr = appendText(stderr, chunk); });
	let childExit = { code: null, signal: null };
	child.on("error", (error) => {
	    stderr = [stderr, error instanceof Error ? error.message : String(error)].filter(Boolean).join(stderr ? "\\n" : "");
	    finish(1, null);
	});
	child.on("exit", (code, signal) => {
	  childExit = { code, signal };
	});
	child.on("close", (code, signal) => {
	  finish(code ?? childExit.code, signal ?? childExit.signal);
	});

timeoutTimer = setTimeout(() => {
  timedOut = true;
  killTarget("SIGTERM");
  killTimer = setTimeout(() => {
    sigkillSent = true;
    killTarget("SIGKILL");
    if (pendingExit) finish(pendingExit.code, pendingExit.signal);
  }, killGraceMs);
}, timeoutMs);
`;

export function describeMachineCommandFailure(operation: string, result: MachineCommandResult): string {
  const detail = (result.stderr || result.stdout || "").trim();
  const suffix = detail ? `: ${detail}` : "";
  return `${operation} failed on ${result.machineId} via ${result.source} (exit ${result.exitCode})${suffix}`;
}

export function requireMachineCommandSuccess(operation: string, result: MachineCommandResult): MachineCommandResult {
  if (result.exitCode !== 0) {
    throw new Error(describeMachineCommandFailure(operation, result));
  }
  return result;
}
