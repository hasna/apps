import { redactErrorMessage, redactPath } from "../redaction.js";
import {
  runMachineCommand,
  type MachineCommandOptions,
  type MachineCommandResult,
  type MachineCommandRunner,
} from "../remote.js";

export const DEFAULT_MACHINE_EXEC_MAX_OUTPUT_CHARS = 131_072;
export const DEFAULT_MACHINE_EXEC_MAX_SCRIPT_CHARS = 65_536;
export const MACHINE_EXEC_MUTATION_OPERATION = "machines_exec";

export interface MachineExecInput {
  machineId: string;
  timeoutMs: number;
  argv?: string[];
  script?: string;
  maxOutputChars?: number;
}

export interface BoundedStream {
  text: string;
  truncated: boolean;
}

export interface MachineExecResult {
  machine_id: string;
  source: MachineCommandResult["source"];
  exit_code: number;
  timed_out: boolean;
  signal: NodeJS.Signals | null;
  stdout: BoundedStream;
  stderr: BoundedStream;
  redacted: true;
}

export function machineExecResourceId(input: MachineExecInput): string {
  return `machine-exec:${input.machineId.trim()}`;
}

export function machineExecMutationArgs(input: MachineExecInput): Record<string, unknown> {
  return {
    machine_id: input.machineId.trim(),
    timeout_ms: input.timeoutMs,
    max_output_chars: input.maxOutputChars ?? DEFAULT_MACHINE_EXEC_MAX_OUTPUT_CHARS,
    argv: input.argv ?? null,
    script: input.script ?? null,
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function argvToShellCommand(argv: string[]): string {
  if (argv.length === 0) {
    throw new Error("exec requires command argv or --script stdin input");
  }
  return argv.map(shellQuote).join(" ");
}

function boundAndRedact(value: string, maxChars: number): BoundedStream {
  const redacted = redactErrorMessage(redactPath(value));
  if (redacted.length <= maxChars) {
    return { text: redacted, truncated: false };
  }

  let keep = maxChars;
  let text = "";
  while (keep >= 0) {
    const suffix = `...[truncated ${redacted.length - keep} chars]`;
    text = `${redacted.slice(0, keep)}${suffix}`;
    if (text.length <= maxChars) {
      return { text, truncated: true };
    }
    keep -= 1;
  }

  return { text: redacted.slice(0, maxChars), truncated: true };
}

export function resolveMachineExecCommand(input: MachineExecInput): string {
  if (!input.machineId.trim()) {
    throw new Error("exec requires --machine <id>");
  }
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error("exec requires --timeout-ms <positive-ms>");
  }

  const hasArgv = Array.isArray(input.argv) && input.argv.length > 0;
  const hasScript = typeof input.script === "string";

  if (hasArgv && hasScript) {
    throw new Error("exec accepts either argv or --script stdin input, not both");
  }
  if (!hasArgv && !hasScript) {
    throw new Error("exec requires command argv or --script stdin input");
  }

  if (hasScript) {
    const script = input.script!.trim();
    if (!script) {
      throw new Error("Script stdin is empty");
    }
    if (script.length > DEFAULT_MACHINE_EXEC_MAX_SCRIPT_CHARS) {
      throw new Error(`Script exceeds ${DEFAULT_MACHINE_EXEC_MAX_SCRIPT_CHARS} characters`);
    }
    return `bash -c ${shellQuote(script)}`;
  }

  return argvToShellCommand(input.argv!);
}

export function runMachineExec(
  input: MachineExecInput,
  runner: MachineCommandRunner = runMachineCommand,
): MachineExecResult {
  const command = resolveMachineExecCommand(input);
  const maxOutputChars = input.maxOutputChars ?? DEFAULT_MACHINE_EXEC_MAX_OUTPUT_CHARS;
  const options: MachineCommandOptions = { timeoutMs: input.timeoutMs };
  const result = runner(input.machineId.trim(), command, options);
  const stdout = boundAndRedact(result.stdout, maxOutputChars);
  const stderr = boundAndRedact(result.stderr, maxOutputChars);

  return {
    machine_id: result.machineId,
    source: result.source,
    exit_code: result.exitCode,
    timed_out: result.timedOut === true,
    signal: result.signal ?? null,
    stdout,
    stderr,
    redacted: true,
  };
}
