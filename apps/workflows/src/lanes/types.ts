/**
 * Lane adapter types (slice E) — shared by the daemon and the four adapters.
 */

export const LANE_KINDS = ["claude", "codex", "cursor", "grok"] as const;
export type LaneKind = (typeof LANE_KINDS)[number];

export interface LaneJob {
  lane: LaneKind;
  /** Prompt handed to the lane agent. */
  prompt?: string;
  /** Shell command alternative (handled by the daemon's built-in executor). */
  command?: string;
  cwd?: string;
  /** Environment for the lane process — never credentials from the vault. */
  env?: Record<string, string>;
  /** Per-invocation budget in ms. Default 120000. */
  timeoutMs?: number;
  model?: string;
}

export interface LaneResult {
  ok: boolean;
  exitCode: number;
  output: string;
  durationMs: number;
  error?: string;
}

export interface LaneAdapter {
  kind: LaneKind;
  run(job: LaneJob): Promise<LaneResult>;
}

/** The substrate (SDK package or CLI binary) is not installed/available. */
export class LaneDependencyMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaneDependencyMissingError";
  }
}

/** Raised when a lane SDK's shape differs from the documented contract. */
export class LaneAdapterShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaneAdapterShapeError";
  }
}

export const DEFAULT_LANE_TIMEOUT_MS = 120_000;

/** Run a promise with a bounded wall-clock budget. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${what} exceeded the ${timeoutMs}ms budget`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Spawn a CLI binary with a bounded timeout; maps ENOENT to a missing-substrate error. */
export function spawnCli(
  cmd: string[],
  opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number; binaryName: string; packageHint: string },
): LaneResult {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LANE_TIMEOUT_MS;
  let proc: ReturnType<typeof Bun.spawnSync>;
  try {
    proc = Bun.spawnSync({
      cmd,
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    });
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    if (message.includes("ENOENT") || /not found/i.test(message)) {
      throw new LaneDependencyMissingError(
        `lane binary ${JSON.stringify(opts.binaryName)} not found on PATH; install it or provide ${opts.packageHint}`,
      );
    }
    return { ok: false, exitCode: 1, output: "", durationMs: Date.now() - started, error: message };
  }
  const durationMs = Date.now() - started;
  const stdout = proc.stdout ? new TextDecoder().decode(proc.stdout) : "";
  const stderr = proc.stderr ? new TextDecoder().decode(proc.stderr) : "";
  const output = stderr ? `${stdout}\n${stderr}`.trim() : stdout.trim();
  const exitCode = proc.exitCode ?? 1;
  return { ok: exitCode === 0, exitCode, output, durationMs };
}
