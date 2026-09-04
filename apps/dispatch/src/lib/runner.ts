import { spawnSync } from "node:child_process";

/** Result of running a command. */
export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Where the command ran: local, or the remote route used. */
  source: "local" | "lan" | "tailscale" | "ssh";
}

/**
 * Route resolution for a remote machine — the shape `@hasna/machines`'
 * `resolveMachineCommand` used to return.
 *
 * `@hasna/machines` was deleted from the public registry and from hasna/apps
 * (owner directive, 2026-09-03; issue #1603), so dispatch no longer imports it
 * and no longer declares it as a dependency: an empty-cache
 * `bun add @hasna/dispatch` must resolve every dependency anonymously. The
 * topology types it contributed are vendored here instead, and remote
 * dispatch resolves routes with plain, non-interactive `ssh` (see
 * {@link sshMachineCommandResolver}).
 *
 * TODO(#1603): once the shared machine-topology helper lands in
 * `@hasna/contracts` and that release is pinned fleet-wide, re-export these
 * types from the contracts kit instead of vendoring them here. Contracts was
 * not released in this run, so the pin is deliberately left untouched.
 */
export type MachineRouteSource = RunResult["source"];

/** A resolved remote command: how to reach the machine, and what to run. */
export interface MachineCommandPlan {
  /** The route the command travels over. */
  source: MachineRouteSource;
  /** A single shell command string, ready for `bash -c`. */
  shellCommand: string;
}

/**
 * Resolves a machine id plus a shell command into an executable plan.
 * Injectable so a future topology provider can supply LAN/Tailscale routes
 * without dispatch taking a dependency on it.
 */
export type MachineCommandResolver = (machineId: string, command: string) => MachineCommandPlan;

/**
 * A Runner executes a command (given as an argv array) and returns its result.
 * Optional `input` is piped to the command's stdin (used for `tmux load-buffer -`).
 *
 * The argv abstraction (rather than a shell string) keeps tmux text payloads
 * safe from shell quoting; remote runners are responsible for safely quoting
 * argv into a single shell command for transport over SSH.
 */
export interface Runner {
  run(argv: string[], input?: string): RunResult;
  /** Machine id this runner targets ("local" for the local host). */
  readonly machine: string;
}

/** POSIX single-quote a value for safe embedding in a shell command. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Quote an argv array into a single shell command string. */
export function quoteArgv(argv: string[]): string {
  return argv.map(shellQuote).join(" ");
}

/** Runs commands on the local host via spawnSync. */
export class LocalRunner implements Runner {
  readonly machine = "local";

  run(argv: string[], input?: string): RunResult {
    const [cmd, ...args] = argv;
    if (!cmd) throw new Error("LocalRunner.run: empty argv");
    const result = spawnSync(cmd, args, {
      encoding: "utf8",
      input,
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) {
      return { stdout: "", stderr: String(result.error.message ?? result.error), exitCode: 127, source: "local" };
    }
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? 1,
      source: "local",
    };
  }
}

export function remoteTimeoutMs(): number {
  const raw = Number(process.env.DISPATCH_REMOTE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 20000;
}

export function fallbackSshCommand(id: string, command: string): string {
  return [
    "ssh",
    "-o BatchMode=yes",
    "-o ConnectTimeout=5",
    "-o ServerAliveInterval=5",
    "-o ServerAliveCountMax=1",
    shellQuote(id),
    shellQuote(command),
  ].join(" ");
}

/**
 * Runs commands on a remote machine through an injected
 * {@link MachineCommandResolver}.
 *
 * Construct via {@link createRunner}, which supplies the built-in
 * {@link sshMachineCommandResolver}; pass a custom resolver to route over a
 * different transport.
 */
export class RemoteRunner implements Runner {
  constructor(
    readonly machine: string,
    private readonly resolve: MachineCommandResolver,
    private readonly timeoutMs: number = remoteTimeoutMs(),
  ) {}

  run(argv: string[], input?: string): RunResult {
    const command = quoteArgv(argv);
    const resolved = this.resolve(this.machine, command);
    const result = spawnSync("bash", ["-c", resolved.shellCommand], {
      encoding: "utf8",
      input,
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
      timeout: this.timeoutMs,
    });
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      const timedOut = code === "ETIMEDOUT";
      return {
        stdout: result.stdout ?? "",
        stderr: timedOut ? `remote command timed out after ${this.timeoutMs}ms` : String(result.error.message ?? result.error),
        exitCode: timedOut ? 124 : 127,
        source: resolved.source,
      };
    }
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? (result.signal ? 124 : 1),
      source: resolved.source,
    };
  }
}

/** True when a machine id refers to the local host. */
export function isLocalMachine(machine: string | undefined): boolean {
  if (!machine) return true;
  const m = machine.toLowerCase();
  return m === "local" || m === "localhost" || m === (process.env.HOSTNAME ?? "").toLowerCase();
}

/**
 * The built-in route resolver: plain, non-interactive `ssh <machine> <cmd>`,
 * bounded by {@link fallbackSshCommand}'s connect/keepalive options.
 */
export const sshMachineCommandResolver: MachineCommandResolver = (machineId, command) => ({
  source: "ssh",
  shellCommand: fallbackSshCommand(machineId, command),
});

/**
 * Build a Runner for the given machine. Local machines get a {@link LocalRunner};
 * remote machines get a {@link RemoteRunner} routed over plain `ssh` unless a
 * custom {@link MachineCommandResolver} is supplied.
 *
 * Stays `async` so existing callers (`await createRunner(...)`) keep working.
 */
export async function createRunner(
  machine?: string,
  resolve: MachineCommandResolver = sshMachineCommandResolver,
): Promise<Runner> {
  if (isLocalMachine(machine)) return new LocalRunner();
  return new RemoteRunner(machine as string, resolve);
}
