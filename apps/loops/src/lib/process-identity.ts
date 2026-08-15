/**
 * Process-identity fingerprinting shared by the daemon (orphan reaping) and
 * the store (expired-lease recovery). A pid alone is not a stable identity —
 * pids are recycled — so destructive or long-lived decisions pair the pid
 * with the process start time recorded at spawn (migration 0006's
 * `process_started_at`).
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const START_TIME_TOLERANCE_MS = 5_000;

let clockTicksCache: number | undefined;

function clockTicksPerSecond(): number {
  if (clockTicksCache !== undefined) return clockTicksCache;
  try {
    const run = spawnSync("getconf", ["CLK_TCK"], { encoding: "utf8" });
    const value = Number(run.stdout.trim());
    clockTicksCache = run.status === 0 && Number.isFinite(value) && value > 0 ? value : 100;
  } catch {
    clockTicksCache = 100;
  }
  return clockTicksCache;
}

let bootTimeCache: number | undefined;
let bootTimeResolved = false;

function bootTimeMs(): number | undefined {
  if (bootTimeResolved) return bootTimeCache;
  bootTimeResolved = true;
  try {
    const match = readFileSync("/proc/stat", "utf8").match(/^btime (\d+)$/m);
    bootTimeCache = match ? Number(match[1]) * 1_000 : undefined;
  } catch {
    bootTimeCache = undefined;
  }
  return bootTimeCache;
}

export function procStatFields(path: string): string[] | undefined {
  try {
    const stat = readFileSync(path, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) return undefined;
    return stat.slice(closeParen + 2).split(" ");
  } catch {
    return undefined;
  }
}

/**
 * Parse BSD `ps -o etime` elapsed time (`[[DD-]HH:]MM:SS`) into whole seconds.
 * Returns undefined for any unparsable value. TZ-independent by construction:
 * elapsed time has no wall-clock interpretation.
 */
function parseBsdElapsedSeconds(etime: string): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
  if (!match) return undefined;
  const days = match[1] === undefined ? 0 : Number(match[1]);
  const hours = match[2] === undefined ? 0 : Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  if (![days, hours, minutes, seconds].every((value) => Number.isFinite(value))) return undefined;
  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
}

export function processStartTimeMs(pid: number): number | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  if (process.platform === "linux") {
    // /proc/<pid>/stat field 22 (starttime) counted after field 3, which is index 0 post-comm.
    const fields = procStatFields(`/proc/${pid}/stat`);
    const startTicks = fields ? Number(fields[19]) : Number.NaN;
    const boot = bootTimeMs();
    if (Number.isFinite(startTicks) && boot !== undefined) {
      return boot + Math.round((startTicks / clockTicksPerSecond()) * 1_000);
    }
  }
  try {
    // BSD (macOS) has no /proc. `ps -o lstart` prints LOCAL wall time, and
    // `Date.parse` of a timezone-less string uses the PARSING RUNTIME's
    // timezone (node: system TZ; bun: UTC) — so the same lstart string
    // converts to different epochs under the two runtimes whenever the
    // system TZ is not UTC, skewing daemon/store process-identity checks by
    // the TZ offset. Elapsed time (`etime`) has no timezone at all: start =
    // now - elapsed, in whichever epoch the caller already uses.
    const run = spawnSync("ps", ["-o", "etime=", "-p", String(pid)], { encoding: "utf8" });
    if (run.status === 0) {
      const elapsedSec = parseBsdElapsedSeconds(run.stdout.trim());
      if (elapsedSec !== undefined) return Date.now() - elapsedSec * 1_000;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * Lenient fingerprint comparison: unknown data (no recorded start time, an
 * unparsable record, or an unresolvable actual start time) counts as a match.
 * Use for non-destructive liveness checks where "possibly alive" is the safe
 * answer (pidfile checks, deciding not to take over a lease).
 */
export function sameProcessStart(
  recorded: string | number | undefined,
  actualMs: number | undefined,
  toleranceMs: number = START_TIME_TOLERANCE_MS,
): boolean {
  if (recorded === undefined || actualMs === undefined) return true;
  const recordedMs = typeof recorded === "number" ? recorded : Date.parse(recorded);
  if (!Number.isFinite(recordedMs)) return true;
  return Math.abs(recordedMs - actualMs) <= toleranceMs;
}

/**
 * Strict fingerprint comparison for destructive paths (signalling processes):
 * true only when both the recorded and actual start times resolve and match
 * within tolerance. Unverifiable identity fails closed as a mismatch.
 */
export function verifiedProcessStart(
  recorded: string | number | undefined,
  actualMs: number | undefined,
  toleranceMs: number = START_TIME_TOLERANCE_MS,
): boolean {
  if (recorded === undefined || actualMs === undefined) return false;
  const recordedMs = typeof recorded === "number" ? recorded : Date.parse(recorded);
  if (!Number.isFinite(recordedMs)) return false;
  return Math.abs(recordedMs - actualMs) <= toleranceMs;
}
