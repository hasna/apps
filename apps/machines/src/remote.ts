import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { getLocalMachineId } from "./db.js";
import { buildSshCommandPlan, validateSshTarget } from "./commands/ssh.js";
import { createIncrementalCredentialRedactor } from "./redaction.js";

export interface MachineCommandResult {
  machineId: string;
  source: "local" | "lan" | "tailscale" | "ssh";
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  signal?: NodeJS.Signals | null;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  stdoutChars?: number;
  stderrChars?: number;
  stdoutRedacted?: boolean;
  stderrRedacted?: boolean;
}

export interface MachineCommandOptions {
  timeoutMs?: number;
  killGraceMs?: number;
  maxOutputChars?: number;
  redactOutput?: boolean;
  /** Bounded opaque stdin forwarded to the resolved local or remote command. */
  stdin?: string | Buffer;
  maxInputBytes?: number;
}

export interface ResolvedMachineCommand {
  source: MachineCommandResult["source"];
  command: string;
  args: string[];
  shellCommand: string;
  usesShell: boolean;
}

export type MachineCommandRunner = (machineId: string, command: string, options?: MachineCommandOptions) => MachineCommandResult;

export const DEFAULT_MACHINE_COMMAND_MAX_INPUT_BYTES = 1_048_576;

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
  const stdin = machineCommandInput(options);
  if (options.timeoutMs && options.timeoutMs > 0 && process.platform !== "win32") {
    return runMachineCommandWithProcessGroupTimeout(machineId, resolved, options, stdin);
  }
  const result = spawnSync(resolved.command, resolved.args, {
    encoding: "utf8",
    env: process.env,
    input: stdin,
    timeout: options.timeoutMs,
    killSignal: "SIGTERM",
  });
  const timedOut = Boolean(result.error && "code" in result.error && result.error.code === "ETIMEDOUT");
  const timeoutMessage = timedOut ? `Command timed out after ${options.timeoutMs}ms.` : "";
  const rawStdout = result.stdout || "";
  const rawStderr = [result.stderr || "", timeoutMessage].filter(Boolean).join(result.stderr ? "\n" : "");
  const stdout = options.redactOutput === true ? redactMachineCommandOutput(rawStdout) : rawStdout;
  const stderr = options.redactOutput === true ? redactMachineCommandOutput(rawStderr) : rawStderr;

  return {
    machineId,
    source: resolved.source,
    stdout,
    stderr,
    exitCode: timedOut ? 124 : result.status ?? 1,
    timedOut,
    signal: result.signal,
    stdoutRedacted: options.redactOutput === true,
    stderrRedacted: options.redactOutput === true,
  };
}

function redactMachineCommandOutput(value: string): string {
  const redactor = createIncrementalCredentialRedactor();
  return redactor.push(value) + redactor.finish();
}

function machineCommandInput(options: MachineCommandOptions): Buffer | undefined {
  if (options.stdin === undefined) return undefined;
  const input = Buffer.isBuffer(options.stdin) ? options.stdin : Buffer.from(options.stdin, "utf8");
  const maxInputBytes = Number.isFinite(options.maxInputBytes) && (options.maxInputBytes ?? 0) > 0
    ? Math.floor(options.maxInputBytes!)
    : DEFAULT_MACHINE_COMMAND_MAX_INPUT_BYTES;
  if (input.byteLength > maxInputBytes) {
    throw new Error(`Machine command stdin exceeds ${maxInputBytes} bytes.`);
  }
  return input;
}

function runMachineCommandWithProcessGroupTimeout(
  machineId: string,
  resolved: ResolvedMachineCommand,
  options: MachineCommandOptions,
  stdin: Buffer | undefined,
): MachineCommandResult {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 1);
  const killGraceMs = Math.max(1, options.killGraceMs ?? 1_000);
  const maxOutputChars = Number.isFinite(options.maxOutputChars) && (options.maxOutputChars ?? 0) > 0
    ? Math.floor(options.maxOutputChars!)
    : null;
  const helperDir = mkdtempSync(join(tmpdir(), "machines-timeout-helper-"));
  const pgidFile = join(helperDir, "pgid");
  const helperHeader = Buffer.from(`${JSON.stringify({ command: resolved.command, args: resolved.args, inputBytes: stdin?.byteLength ?? 0 })}\n`, "utf8");
  const helper = spawnSync(process.execPath, ["--eval", PROCESS_GROUP_TIMEOUT_HELPER], {
    input: stdin ? Buffer.concat([helperHeader, stdin]) : helperHeader,
    encoding: "utf8",
    env: {
      ...process.env,
      HASNA_MACHINES_COMMAND_TIMEOUT_MS: String(timeoutMs),
      HASNA_MACHINES_COMMAND_KILL_GRACE_MS: String(killGraceMs),
      HASNA_MACHINES_COMMAND_PGID_FILE: pgidFile,
      HASNA_MACHINES_COMMAND_MAX_OUTPUT_CHARS: maxOutputChars === null ? "" : String(maxOutputChars),
      HASNA_MACHINES_COMMAND_REDACT_OUTPUT: options.redactOutput === true ? "1" : "",
    },
    timeout: timeoutMs + killGraceMs + 2_000,
    killSignal: "SIGKILL",
    maxBuffer: maxOutputChars === null
      ? 64 * 1024 * 1024
      : Math.max(1024 * 1024, (maxOutputChars * 16) + (64 * 1024)),
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
        stdoutTruncated: parsed.stdoutTruncated,
        stderrTruncated: parsed.stderrTruncated,
        stdoutChars: parsed.stdoutChars,
        stderrChars: parsed.stderrChars,
        stdoutRedacted: parsed.stdoutRedacted,
        stderrRedacted: parsed.stderrRedacted,
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
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutChars: 0,
      stderrChars: stderr.length,
      stdoutRedacted: false,
      stderrRedacted: false,
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
      stdoutTruncated: parsed.stdoutTruncated === true,
      stderrTruncated: parsed.stderrTruncated === true,
      stdoutChars: typeof parsed.stdoutChars === "number" ? parsed.stdoutChars : parsed.stdout.length,
      stderrChars: typeof parsed.stderrChars === "number" ? parsed.stderrChars : parsed.stderr.length,
      stdoutRedacted: parsed.stdoutRedacted === true,
      stderrRedacted: parsed.stderrRedacted === true,
    };
  } catch {
    return null;
  }
}

const PROCESS_GROUP_TIMEOUT_HELPER = `
	const { spawn } = require("node:child_process");
	const { readFileSync, writeFileSync } = require("node:fs");
	${createIncrementalCredentialRedactor.toString()}

	const input = readFileSync(0);
	const headerEnd = input.indexOf(10);
	if (headerEnd < 0) throw new Error("timeout helper input header is missing");
	const plan = JSON.parse(input.subarray(0, headerEnd).toString("utf8"));
	const command = String(plan.command || "");
	const args = Array.isArray(plan.args) ? plan.args.map(String) : [];
	const inputBytes = Math.max(0, Number.parseInt(String(plan.inputBytes || "0"), 10));
	const childInput = input.subarray(headerEnd + 1);
	if (childInput.byteLength !== inputBytes) throw new Error("timeout helper input length mismatch");
	const timeoutMs = Math.max(1, Number.parseInt(process.env.HASNA_MACHINES_COMMAND_TIMEOUT_MS || "1", 10));
	const killGraceMs = Math.max(1, Number.parseInt(process.env.HASNA_MACHINES_COMMAND_KILL_GRACE_MS || "1000", 10));
	const parsedMaxOutputChars = Number.parseInt(process.env.HASNA_MACHINES_COMMAND_MAX_OUTPUT_CHARS || "", 10);
	const maxOutputChars = Number.isFinite(parsedMaxOutputChars) && parsedMaxOutputChars > 0 ? parsedMaxOutputChars : null;
	const redactOutput = process.env.HASNA_MACHINES_COMMAND_REDACT_OUTPUT === "1";
	const pgidFile = process.env.HASNA_MACHINES_COMMAND_PGID_FILE || "";
	const stdoutRedactor = redactOutput ? createIncrementalCredentialRedactor() : null;
	const stderrRedactor = redactOutput ? createIncrementalCredentialRedactor() : null;
	let stdout = "";
	let stderr = "";
	let stdoutChars = 0;
	let stderrChars = 0;
	let stdoutTruncated = false;
	let stderrTruncated = false;
	let timedOut = false;
	let finished = false;
let timeoutTimer;
let killTimer;
let sigkillSent = false;
let pendingExit = null;

const child = spawn(command, args, {
  detached: true,
  stdio: ["pipe", "pipe", "pipe"],
	  env: process.env,
	});
	child.stdin.on("error", () => {});
	child.stdin.end(childInput);

	if (pgidFile && child.pid) {
	  try {
	    writeFileSync(pgidFile, String(child.pid), { mode: 0o600 });
	  } catch {}
	}

function appendCollectedText(target, text, stream) {
  if (maxOutputChars === null) return target + text;

  const keep = Math.max(0, maxOutputChars - target.length);
  if (text.length > keep) {
    if (stream === "stdout") stdoutTruncated = true;
    else stderrTruncated = true;
  }
  return target + text.slice(0, keep);
}

function appendText(target, chunk, stream) {
  const text = String(chunk);
  if (stream === "stdout") stdoutChars += text.length;
  else stderrChars += text.length;
  const redactor = stream === "stdout" ? stdoutRedactor : stderrRedactor;
  const safeText = redactor ? redactor.push(text) : text;
  return appendCollectedText(target, safeText, stream);
}

function finishText(target, stream) {
  const redactor = stream === "stdout" ? stdoutRedactor : stderrRedactor;
  return appendCollectedText(target, redactor ? redactor.finish() : "", stream);
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
	    if (stderr) stderr = appendText(stderr, "\\n", "stderr");
	    stderr = appendText(stderr, "Command timed out after " + timeoutMs + "ms.", "stderr");
	  }
	  stdout = finishText(stdout, "stdout");
	  stderr = finishText(stderr, "stderr");
	  const exitCode = timedOut ? 124 : code ?? 1;
	  process.stdout.write(JSON.stringify({
	    stdout,
	    stderr,
	    exitCode,
	    timedOut,
	    signal: signal ?? null,
	    stdoutTruncated,
	    stderrTruncated,
	    stdoutChars,
	    stderrChars,
	    stdoutRedacted: redactOutput,
	    stderrRedacted: redactOutput,
	  }), () => process.exit(exitCode));
	}

	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => { stdout = appendText(stdout, chunk, "stdout"); });
	child.stderr.on("data", (chunk) => { stderr = appendText(stderr, chunk, "stderr"); });
	let childExit = { code: null, signal: null };
	child.on("error", (error) => {
	    if (stderr) stderr = appendText(stderr, "\\n", "stderr");
	    stderr = appendText(stderr, error instanceof Error ? error.message : String(error), "stderr");
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
