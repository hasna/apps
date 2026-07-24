import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_COMMAND_DEADLINE_MS = 120_000;
export const DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;
const MAX_EXECUTABLE_BYTES = 512 * 1024 * 1024;
const PROCESS_GROUP_QUIESCENCE_DEADLINE_MS = 2_000;
const PROCESS_GROUP_QUIESCENCE_POLL_MS = 5;
const SUPERVISOR_SCRIPT = String.raw`
status_path=$1
main=$2
shift 2
"$main" "$@" <&3 3<&- &
main_pid=$!
wait "$main_pid"
main_status=$?
printf '%s\n' "$main_status" > "$status_path"
kill -STOP "$$"
exit 70
`;

export interface ExecutableIdentity {
  path: string;
  mode: string;
  size: number;
  sha256: string;
}

export interface PinnedCommandResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  outputLimited: boolean;
  termination: "exit" | "timeout" | "output-limit" | "spawn-error";
  deadlineMs: number;
  outputLimitBytes: number;
  stdin: "ignore" | "bytes";
  durationMs: number;
  executable: ExecutableIdentity;
}

export class CommandExecutionError extends Error {
  constructor(
    public readonly code: "COMMAND_TIMEOUT" | "COMMAND_OUTPUT_LIMIT" | "COMMAND_SPAWN" | "COMMAND_PROCESS_TREE",
    message: string,
    public readonly result: PinnedCommandResult,
  ) {
    super(message);
    this.name = "CommandExecutionError";
  }
}

export interface RunPinnedCommandOptions {
  executable: ExecutableIdentity;
  args: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: "ignore" | Uint8Array;
  deadlineMs?: number;
  outputLimitBytes?: number;
  outputCapture?: "pipes" | "files";
  pathBindings?: Readonly<Record<string, ExecutableIdentity>>;
  temporaryRoot?: string;
  /** Deterministic adversarial hook. Production callers must omit it. */
  onExecutablePinnedForTest?: () => void;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function modeString(mode: number): string {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}

function readStableExecutable(path: string): { identity: ExecutableIdentity; bytes: Buffer; mode: number } {
  const resolved = realpathSync(path);
  const descriptor = openSync(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > MAX_EXECUTABLE_BYTES || (before.mode & 0o111) === 0) {
      throw new Error(`executable is not a bounded executable regular file: ${path}`);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || bytes.byteLength !== after.size
    ) {
      throw new Error(`executable changed while identified: ${path}`);
    }
    return {
      identity: {
        path: resolved,
        mode: modeString(before.mode),
        size: before.size,
        sha256: sha256(bytes),
      },
      bytes,
      mode: before.mode,
    };
  } finally {
    closeSync(descriptor);
  }
}

export function executableIdentity(path: string): ExecutableIdentity {
  return readStableExecutable(path).identity;
}

export function trustedExecutableDirectories(): string[] {
  const home = userInfo().homedir;
  return [...new Set([
    dirname(realpathSync(process.execPath)),
    "/usr/local/sbin",
    "/usr/local/bin",
    "/usr/sbin",
    "/usr/bin",
    "/sbin",
    "/bin",
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
  ])];
}

export function resolveTrustedExecutable(
  name: string,
  directories: readonly string[] = trustedExecutableDirectories(),
): ExecutableIdentity {
  if (!/^[A-Za-z0-9._+-]+$/.test(name)) throw new Error(`invalid executable name: ${name}`);
  if (name === "bun") return executableIdentity(process.execPath);
  for (const directory of directories) {
    const candidate = join(directory, name);
    if (!existsSync(candidate)) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return executableIdentity(candidate);
    } catch {
      // Continue through the fixed trusted-directory set. Ambient PATH is never consulted.
    }
  }
  throw new Error(`trusted executable is unavailable: ${name}`);
}

function assertIdentity(actual: ExecutableIdentity, expected: ExecutableIdentity, label: string): void {
  if (
    actual.path !== realpathSync(expected.path)
    || actual.mode !== expected.mode
    || actual.size !== expected.size
    || actual.sha256 !== expected.sha256
  ) {
    throw new Error(`${label} identity changed before execution`);
  }
}

function pinExecutable(
  identity: ExecutableIdentity,
  directory: string,
  leaf: string,
): { descriptor: number; descriptorPath: string } {
  const source = readStableExecutable(identity.path);
  assertIdentity(source.identity, identity, leaf);
  const path = join(directory, leaf);
  const writer = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    source.mode & 0o555,
  );
  try {
    writeFileSync(writer, source.bytes);
  } finally {
    closeSync(writer);
  }
  chmodSync(path, source.mode & 0o555);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const pinned = fstatSync(descriptor);
  if (!pinned.isFile() || pinned.size !== identity.size || sha256(readFileSync(descriptor)) !== identity.sha256) {
    closeSync(descriptor);
    throw new Error(`${leaf} pinned copy identity mismatch`);
  }
  return { descriptor, descriptorPath: `/proc/${process.pid}/fd/${descriptor}` };
}

function killProcessGroup(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

async function waitForProcessGroupQuiescence(pid: number | undefined): Promise<void> {
  if (!pid) return;
  const deadline = performance.now() + PROCESS_GROUP_QUIESCENCE_DEADLINE_MS;
  while (processGroupExists(pid)) {
    if (performance.now() >= deadline) {
      throw new Error(`process group ${pid} did not quiesce after termination`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, PROCESS_GROUP_QUIESCENCE_POLL_MS));
  }
}

function readDescriptorPrefix(descriptor: number, maxBytes: number): Buffer {
  const stat = fstatSync(descriptor);
  if (!stat.isFile()) throw new Error("command output capture is not a regular file");
  const bytes = Buffer.alloc(Math.min(stat.size, maxBytes));
  let offset = 0;
  while (offset < bytes.byteLength) {
    const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
    if (count === 0) break;
    offset += count;
  }
  return offset === bytes.byteLength ? bytes : bytes.subarray(0, offset);
}

export async function runPinnedCommand(options: RunPinnedCommandOptions): Promise<PinnedCommandResult> {
  const deadlineMs = options.deadlineMs ?? DEFAULT_COMMAND_DEADLINE_MS;
  const outputLimitBytes = options.outputLimitBytes ?? DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES;
  const outputCapture = options.outputCapture ?? "pipes";
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) throw new Error("command deadline must be a positive integer");
  if (!Number.isSafeInteger(outputLimitBytes) || outputLimitBytes <= 0) throw new Error("command output limit must be a positive integer");
  if (options.args.length > 256 || options.args.some((value) => value.includes("\0"))) throw new Error("command argv is invalid or unbounded");

  const temporaryRoot = options.temporaryRoot ?? tmpdir();
  mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
  const commandRoot = mkdtempSync(join(temporaryRoot, "todos-stage-a-command-"));
  const pinRoot = join(commandRoot, "pins");
  const binRoot = join(commandRoot, "bin");
  const descriptors: number[] = [];
  const started = performance.now();
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let termination: PinnedCommandResult["termination"] = "exit";
  let spawnError: Error | undefined;
  let childPid: number | undefined;
  let childClosed = false;
  let groupTerminationRequested = false;
  let stdoutWriter: number | undefined;
  let stderrWriter: number | undefined;
  let stdoutReader: number | undefined;
  let stderrReader: number | undefined;

  try {
    mkdirSync(pinRoot, { mode: 0o700 });
    mkdirSync(binRoot, { mode: 0o700 });
    const main = pinExecutable(options.executable, pinRoot, "main");
    descriptors.push(main.descriptor);
    const supervisorIdentity = resolveTrustedExecutable("bash");
    const supervisor = supervisorIdentity.path === options.executable.path
      && supervisorIdentity.mode === options.executable.mode
      && supervisorIdentity.size === options.executable.size
      && supervisorIdentity.sha256 === options.executable.sha256
      ? main
      : pinExecutable(supervisorIdentity, pinRoot, "supervisor");
    if (supervisor !== main) descriptors.push(supervisor.descriptor);
    for (const [name, identity] of Object.entries(options.pathBindings ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
      if (!/^[A-Za-z0-9._+-]+$/.test(name)) throw new Error(`invalid PATH binding name: ${name}`);
      const pinned = pinExecutable(identity, pinRoot, `path-${name}`);
      descriptors.push(pinned.descriptor);
      symlinkSync(pinned.descriptorPath, join(binRoot, name));
    }
    options.onExecutablePinnedForTest?.();

    const env = { ...(options.env ?? process.env) };
    if (Object.keys(options.pathBindings ?? {}).length > 0) env.PATH = binRoot;
    const stdinMode = options.stdin instanceof Uint8Array ? "bytes" : "ignore";
    if (outputCapture === "files") {
      const stdoutPath = join(commandRoot, "stdout.bin");
      const stderrPath = join(commandRoot, "stderr.bin");
      stdoutWriter = openSync(stdoutPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      stderrWriter = openSync(stderrPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      stdoutReader = openSync(stdoutPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      stderrReader = openSync(stderrPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    }
    const statusPath = join(commandRoot, "status.bin");
    const statusDescriptor = openSync(
      statusPath,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    descriptors.push(statusDescriptor);
    const statusDescriptorPath = `/proc/${process.pid}/fd/${statusDescriptor}`;
    const child = spawn(supervisor.descriptorPath, [
      "-c",
      SUPERVISOR_SCRIPT,
      "stage-a-supervisor",
      statusDescriptorPath,
      main.descriptorPath,
      ...options.args,
    ], {
      cwd: options.cwd,
      env,
      detached: true,
      stdio: [
        "ignore",
        outputCapture === "files" ? stdoutWriter! : "pipe",
        outputCapture === "files" ? stderrWriter! : "pipe",
        stdinMode === "bytes" ? "pipe" : "ignore",
      ],
    });
    childPid = child.pid;
    const terminateGroup = (): void => {
      if (groupTerminationRequested) return;
      groupTerminationRequested = true;
      killProcessGroup(childPid);
    };
    if (stdoutWriter !== undefined) {
      closeSync(stdoutWriter);
      stdoutWriter = undefined;
    }
    if (stderrWriter !== undefined) {
      closeSync(stderrWriter);
      stderrWriter = undefined;
    }

    const append = (stream: "stdout" | "stderr", chunk: Buffer): void => {
      const current = stream === "stdout" ? stdout : stderr;
      const remaining = Math.max(0, outputLimitBytes - stdout.byteLength - stderr.byteLength);
      const next = remaining > 0 ? Buffer.concat([current, chunk.subarray(0, remaining)]) : current;
      if (stream === "stdout") stdout = next;
      else stderr = next;
      if (chunk.byteLength > remaining && termination === "exit") {
        termination = "output-limit";
        terminateGroup();
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));

    const outputMonitor = outputCapture === "files" ? setInterval(() => {
      const size = fstatSync(stdoutReader!).size + fstatSync(stderrReader!).size;
      if (size > outputLimitBytes && termination === "exit") {
        termination = "output-limit";
        terminateGroup();
      }
    }, 10) : undefined;

    let mainExitCode: number | undefined;
    const readSupervisorStatus = (): void => {
      if (mainExitCode !== undefined || termination !== "exit") return;
      const statusBytes = readDescriptorPrefix(statusDescriptor, 33);
      if (statusBytes.byteLength === 0) return;
      if (statusBytes.byteLength > 32) {
        spawnError = new Error("command supervisor emitted an invalid status record");
        termination = "spawn-error";
        terminateGroup();
        return;
      }
      const status = statusBytes.toString("ascii");
      if (!status.endsWith("\n")) return;
      if (!/^(?:0|[1-9][0-9]{0,2})\n$/.test(status)) {
        spawnError = new Error("command supervisor emitted an invalid exit status");
        termination = "spawn-error";
        terminateGroup();
        return;
      }
      mainExitCode = Number.parseInt(status, 10);
      if (mainExitCode > 255) {
        spawnError = new Error("command supervisor exit status is out of range");
        termination = "spawn-error";
      }
      terminateGroup();
    };
    const statusMonitor = setInterval(readSupervisorStatus, 1);
    const timer = setTimeout(() => {
      readSupervisorStatus();
      if (mainExitCode !== undefined) return;
      if (termination === "exit") termination = "timeout";
      terminateGroup();
    }, deadlineMs);
    try {
      if (stdinMode === "bytes") {
        const stdinPipe = child.stdio[3] as { end(value: Uint8Array): void } | null;
        if (!stdinPipe) throw new Error("command supervisor stdin pipe is unavailable");
        stdinPipe.end(Buffer.from(options.stdin as Uint8Array));
      }
      const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once("error", (error) => {
          spawnError = error;
          if (termination === "exit") termination = "spawn-error";
          terminateGroup();
        });
        child.once("close", (_code, signal) => {
          if (termination === "exit" && mainExitCode === undefined) {
            spawnError = new Error("command supervisor exited without a main-command status");
            termination = "spawn-error";
          }
          resolve({ code: mainExitCode ?? null, signal: mainExitCode === undefined ? signal : null });
        });
      });
      childClosed = true;
      try {
        await waitForProcessGroupQuiescence(childPid);
      } catch (error) {
        const result: PinnedCommandResult = {
          exitCode: 70,
          signal: outcome.signal,
          stdout,
          stderr,
          timedOut: false,
          outputLimited: false,
          termination: "spawn-error",
          deadlineMs,
          outputLimitBytes,
          stdin: stdinMode,
          durationMs: Math.max(0, performance.now() - started),
          executable: options.executable,
        };
        throw new CommandExecutionError(
          "COMMAND_PROCESS_TREE",
          error instanceof Error ? error.message : "command process group did not quiesce",
          result,
        );
      }
      if (outputCapture === "files") {
        const stdoutSize = fstatSync(stdoutReader!).size;
        const stderrSize = fstatSync(stderrReader!).size;
        if (stdoutSize + stderrSize > outputLimitBytes && termination === "exit") termination = "output-limit";
        stdout = readDescriptorPrefix(stdoutReader!, outputLimitBytes);
        stderr = readDescriptorPrefix(stderrReader!, Math.max(0, outputLimitBytes - stdout.byteLength));
      }
      const result: PinnedCommandResult = {
        exitCode: outcome.code ?? (termination === "timeout" ? 124 : termination === "output-limit" ? 125 : 70),
        signal: outcome.signal,
        stdout,
        stderr,
        timedOut: termination === "timeout",
        outputLimited: termination === "output-limit",
        termination,
        deadlineMs,
        outputLimitBytes,
        stdin: stdinMode,
        durationMs: Math.max(0, performance.now() - started),
        executable: options.executable,
      };
      if (termination === "timeout") {
        throw new CommandExecutionError("COMMAND_TIMEOUT", `command exceeded ${deadlineMs}ms deadline`, result);
      }
      if (termination === "output-limit") {
        throw new CommandExecutionError("COMMAND_OUTPUT_LIMIT", `command exceeded ${outputLimitBytes} byte output limit`, result);
      }
      if (termination === "spawn-error") {
        throw new CommandExecutionError("COMMAND_SPAWN", spawnError?.message ?? "command spawn failed", result);
      }
      return result;
    } finally {
      clearTimeout(timer);
      clearInterval(statusMonitor);
      if (outputMonitor !== undefined) clearInterval(outputMonitor);
    }
  } finally {
    if (!childClosed && !groupTerminationRequested) killProcessGroup(childPid);
    for (const descriptor of [stdoutWriter, stderrWriter, stdoutReader, stderrReader]) {
      if (descriptor === undefined) continue;
      try {
        closeSync(descriptor);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EBADF") throw error;
      }
    }
    for (const descriptor of descriptors) {
      try {
        closeSync(descriptor);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EBADF") throw error;
      }
    }
    rmSync(commandRoot, { recursive: true, force: true });
  }
}
