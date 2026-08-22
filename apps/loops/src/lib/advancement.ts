import type { Loop, LoopRun } from "../types.js";
import { classifyRunFailure, isTransientSignalExitInteropFailure } from "./health.js";
import { computeNextAfter } from "./recurrence.js";

export const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 5;
export const CIRCUIT_BREAKER_REASON_PREFIX = "circuit breaker open";
export const EXPIRY_REASON_PREFIX = "expired after consecutive successful runs";
const THROTTLED_RETRY_MULTIPLIER = 4;
const MAX_RETRY_EXPONENT = 20;

/** Hard cap on rows examined while paging a streak window past skipped rows. */
export const MAX_BREAKER_WINDOW_SCAN = 1_000;

export type CircuitBreakerThreshold = number | ((loop: Loop) => number | undefined);

export type LoopAdvancementPatch = Partial<
  Pick<Loop, "status" | "nextRunAt" | "retryScheduledFor">
>;

export type LoopAdvancementPlan =
  | {
      kind: "none";
      reason: "running" | "missing" | "inactive" | "archived" | "stale" | "already_applied";
    }
  | { kind: "update"; reason: "retry" | "deferred_retry" | "recurrence"; patch: LoopAdvancementPatch }
  | {
      kind: "circuit_breaker";
      failures: number;
      reason: string;
      markerScheduledFor: string;
      patch: LoopAdvancementPatch;
    }
  | {
      kind: "expires_after_runs";
      successes: number;
      reason: string;
      markerScheduledFor: string;
      patch: LoopAdvancementPatch;
    };

export function loopAdvancementPatchMatchesCurrent(
  current: Loop,
  patch: LoopAdvancementPatch,
): boolean {
  return (
    (patch.status === undefined || patch.status === current.status) &&
    (!("nextRunAt" in patch) || patch.nextRunAt === current.nextRunAt) &&
    (!("retryScheduledFor" in patch) || patch.retryScheduledFor === current.retryScheduledFor)
  );
}

/**
 * Exponential retry backoff with jitter:
 * delay = retryDelayMs * 2^(attempt-1) * (0.5 + random), capped at 6h.
 * Provider-gated failures back off 4x harder.
 */
export function retryBackoffDelayMs(loop: Loop, run: LoopRun, random: () => number = Math.random): number {
  return retryBackoffDelayMsForSample(loop, run, random());
}

function retryBackoffDelayMsForSample(loop: Loop, run: LoopRun, randomSample: number): number {
  const attempt = Math.max(1, run.attempt);
  const failure = classifyRunFailure(run);
  const throttled =
    failure?.classification === "rate_limit" ||
    failure?.classification === "auth" ||
    failure?.classification === "provider_capacity" ||
    failure?.classification === "provider_unavailable";
  const growth = 2 ** Math.min(attempt - 1, MAX_RETRY_EXPONENT);
  const base = loop.retryDelayMs * growth * (throttled ? THROTTLED_RETRY_MULTIPLIER : 1);
  const jitter = 0.5 + randomSample;
  return Math.min(MAX_RETRY_DELAY_MS, Math.round(base * jitter));
}

function nextAfterRetry(loop: Loop, run: LoopRun, now: Date, randomSample = 0.5): string {
  return new Date(now.getTime() + retryBackoffDelayMsForSample(loop, run, randomSample)).toISOString();
}

function withoutCursorRegression(current: Loop, candidate: string): string {
  if (!current.nextRunAt) return candidate;
  return new Date(current.nextRunAt).getTime() > new Date(candidate).getTime()
    ? current.nextRunAt
    : candidate;
}

function isStreakMarker(run: LoopRun): boolean {
  return (
    run.status === "skipped" &&
    ((run.error?.startsWith(CIRCUIT_BREAKER_REASON_PREFIX) ?? false) ||
      (run.error?.startsWith(EXPIRY_REASON_PREFIX) ?? false))
  );
}

/**
 * Collect a streak window that pages past ordinary overlap-skip bookkeeping
 * rows. A hung overlap:"skip" loop mints one skipped row per due slot, so a
 * raw newest-N read can fill its window with neutral rows and push every real
 * outcome beyond the streak's reach. This pages the store read (created_at
 * DESC) until the window holds `windowLimit` meaningful rows or `maxScan`
 * rows have been examined. Circuit-breaker and expiry marker rows are kept:
 * the streak counters read them as watermarks, so a manual resume keeps
 * starting a fresh streak. Accepts both the synchronous local store read and
 * the hosted storage contract's async read.
 */
export function collectBreakerWindowRuns(
  listRuns: (opts: { limit: number; offset: number }) => readonly LoopRun[],
  windowLimit: number,
  maxScan?: number,
): LoopRun[];
export function collectBreakerWindowRuns(
  listRuns: (opts: { limit: number; offset: number }) => Promise<readonly LoopRun[]>,
  windowLimit: number,
  maxScan?: number,
): Promise<LoopRun[]>;
export function collectBreakerWindowRuns(
  listRuns: (opts: { limit: number; offset: number }) => readonly LoopRun[] | Promise<readonly LoopRun[]>,
  windowLimit: number,
  maxScan = MAX_BREAKER_WINDOW_SCAN,
): LoopRun[] | Promise<LoopRun[]> {
  const window: LoopRun[] = [];
  let offset = 0;
  const keep = (page: readonly LoopRun[]): void => {
    for (const run of page) {
      if (run.status === "skipped" && !isStreakMarker(run)) continue;
      window.push(run);
    }
  };
  const collect = (): LoopRun[] | Promise<LoopRun[]> => {
    while (window.length < windowLimit && offset < maxScan) {
      const page = listRuns({ limit: Math.min(windowLimit, maxScan - offset), offset });
      if (typeof (page as Promise<readonly LoopRun[]>).then === "function") {
        return (page as Promise<readonly LoopRun[]>).then((resolved) => {
          offset += resolved.length;
          if (resolved.length === 0) return window;
          keep(resolved);
          return collect();
        });
      }
      const resolved = page as readonly LoopRun[];
      offset += resolved.length;
      if (resolved.length === 0) break;
      keep(resolved);
    }
    return window;
  };
  return collect();
}

export function resolveBreakerThreshold(loop: Loop, override?: CircuitBreakerThreshold): number {
  const perLoop = (loop as { circuitBreakerThreshold?: unknown }).circuitBreakerThreshold;
  if (typeof perLoop === "number" && Number.isFinite(perLoop)) return Math.floor(perLoop);
  const resolved = typeof override === "function" ? override(loop) : override;
  if (typeof resolved === "number" && Number.isFinite(resolved)) return Math.floor(resolved);
  return DEFAULT_CIRCUIT_BREAKER_THRESHOLD;
}

/**
 * Count consecutive final failures from newest-first run history.
 *
 * Retryable failures and the known transient Bun/signal-exit loader mismatch
 * are neutral, a success resets the streak, and the newest circuit-breaker
 * marker is a watermark so a manual resume starts a fresh streak.
 */
export function consecutiveFailureCountFromRuns(
  runs: readonly LoopRun[],
  maxAttempts = 1,
): number {
  let watermark: number | undefined;
  for (const run of runs) {
    if (run.status !== "skipped" || !run.error?.startsWith(CIRCUIT_BREAKER_REASON_PREFIX)) continue;
    const at = new Date(run.scheduledFor).getTime();
    if (watermark === undefined || at > watermark) watermark = at;
  }
  // Skipped bookkeeping rows carry no outcome signal. Exclude them from the
  // working list entirely (not just `continue` past them) so neutral rows can
  // never consume counting positions inside a bounded window.
  const meaningful = runs.filter((run) => run.status !== "skipped");
  let count = 0;
  for (const run of meaningful) {
    if (run.status === "running") continue;
    if (watermark !== undefined && new Date(run.scheduledFor).getTime() <= watermark) continue;
    if (run.status === "succeeded") break;
    if (run.attempt < maxAttempts) continue;
    if (isTransientSignalExitInteropFailure(run)) continue;
    count += 1;
  }
  return count;
}

/**
 * Count consecutive successful runs from newest-first run history.
 *
 * Mirrors {@link consecutiveFailureCountFromRuns} with inverted polarity:
 * a final failure (or timeout/abandonment) resets the streak, a success
 * advances it, and retryable failures (attempt < maxAttempts) plus the
 * known transient Bun/signal-exit loader mismatch are neutral. Skipped runs
 * are neutral (they carry no outcome signal). The newest expiry marker is a
 * watermark so a manual resume starts a fresh streak.
 *
 * "Success" is run status `succeeded` (provider exited 0 with output).
 * Findings are not representable in the run record today, so a no-findings
 * check loop that exits 0 counts as successful — a deliberate, documented
 * approximation (a clean check loop expires after N runs).
 */
export function consecutiveSuccessCountFromRuns(
  runs: readonly LoopRun[],
  maxAttempts = 1,
): number {
  let watermark: number | undefined;
  for (const run of runs) {
    if (run.status !== "skipped" || !run.error?.startsWith(EXPIRY_REASON_PREFIX)) continue;
    const at = new Date(run.scheduledFor).getTime();
    if (watermark === undefined || at > watermark) watermark = at;
  }
  // Skipped bookkeeping rows carry no outcome signal. Exclude them from the
  // working list entirely (not just `continue` past them) so neutral rows can
  // never consume counting positions inside a bounded window.
  const meaningful = runs.filter((run) => run.status !== "skipped");
  let count = 0;
  for (const run of meaningful) {
    if (run.status === "running") continue;
    if (watermark !== undefined && new Date(run.scheduledFor).getTime() <= watermark) continue;
    if (run.status === "succeeded") {
      count += 1;
      continue;
    }
    if (run.attempt < maxAttempts) continue;
    if (isTransientSignalExitInteropFailure(run)) continue;
    break;
  }
  return count;
}

function isStaleFinalization(current: Loop, run: LoopRun): boolean {
  if (current.retryScheduledFor) return current.retryScheduledFor !== run.scheduledFor;
  if (!current.nextRunAt) return false;
  return new Date(current.nextRunAt).getTime() > new Date(run.scheduledFor).getTime();
}

function retryTimingWasAppliedForAttempt(current: Loop, run: LoopRun): boolean {
  if (current.retryScheduledFor !== run.scheduledFor || !current.nextRunAt) return false;
  const attemptStartedAt = run.startedAt ?? run.scheduledFor;
  return new Date(current.nextRunAt).getTime() > new Date(attemptStartedAt).getTime();
}

/**
 * Pure scheduling policy shared by the local scheduler and hosted API.
 * Callers gather current loop state, deferred retry state, and recent history,
 * then apply the returned storage mutations using their native sync/async API.
 */
export function planLoopAdvancement(input: {
  current: Loop | undefined;
  run: LoopRun;
  finishedAt: Date;
  succeeded: boolean;
  deferredRetry?: LoopRun;
  retryIntentRun?: LoopRun;
  recentRuns?: readonly LoopRun[];
  retryRandom?: number;
  circuitBreakerThreshold?: CircuitBreakerThreshold;
}): LoopAdvancementPlan {
  const { current, run, finishedAt } = input;
  const failed = run.status === "failed" || run.status === "timed_out" || run.status === "abandoned";
  if (run.status === "running") return { kind: "none", reason: "running" };
  if (!current) return { kind: "none", reason: "missing" };
  if (current.archivedAt) return { kind: "none", reason: "archived" };
  if (current.status !== "active") return { kind: "none", reason: "inactive" };

  if (input.deferredRetry) {
    const deferredRetry = input.deferredRetry;
    if (
      current.retryScheduledFor &&
      new Date(current.retryScheduledFor).getTime() < new Date(deferredRetry.scheduledFor).getTime() &&
      input.retryIntentRun?.status === "running"
    ) {
      return { kind: "none", reason: "stale" };
    }
    if (retryTimingWasAppliedForAttempt(current, deferredRetry)) {
      return { kind: "none", reason: "already_applied" };
    }
    const sameAttempt = deferredRetry.id === run.id && deferredRetry.attempt === run.attempt;
    const retryAt = nextAfterRetry(
      current,
      deferredRetry,
      sameAttempt ? finishedAt : new Date(deferredRetry.updatedAt),
      input.retryRandom,
    );
    return {
      kind: "update",
      reason: sameAttempt ? "retry" : "deferred_retry",
      patch: {
        status: "active",
        nextRunAt: withoutCursorRegression(current, retryAt),
        retryScheduledFor: deferredRetry.scheduledFor,
      },
    };
  }

  if (failed && run.attempt < current.maxAttempts) {
    if (current.retryScheduledFor && current.retryScheduledFor !== run.scheduledFor) {
      return { kind: "none", reason: "stale" };
    }
    // A retry reuses the same run row and scheduledFor while incrementing its
    // attempt. Preserve timing only when it was planned after this attempt
    // started; a reclaimed attempt starts at/after the prior retry cursor and
    // must compute its own exponential backoff.
    if (retryTimingWasAppliedForAttempt(current, run)) {
      return { kind: "none", reason: "already_applied" };
    }
    const retryAt = nextAfterRetry(current, run, finishedAt, input.retryRandom);
    return {
      kind: "update",
      reason: "retry",
      patch: {
        status: "active",
        nextRunAt: withoutCursorRegression(current, retryAt),
        retryScheduledFor: run.scheduledFor,
      },
    };
  }

  if (isStaleFinalization(current, run)) return { kind: "none", reason: "stale" };

  if (failed) {
    const threshold = resolveBreakerThreshold(current, input.circuitBreakerThreshold);
    if (threshold > 0) {
      const failures = consecutiveFailureCountFromRuns(input.recentRuns ?? [], current.maxAttempts);
      if (failures >= threshold) {
        const reason = `${CIRCUIT_BREAKER_REASON_PREFIX}: ${failures} consecutive failed runs; loop auto-paused (resume with 'loops resume ${current.name}')`;
        const nextRunAt = computeNextAfter(current.schedule, new Date(run.scheduledFor), finishedAt);
        return {
          kind: "circuit_breaker",
          failures,
          reason,
          markerScheduledFor: finishedAt.toISOString(),
          patch: {
            status: "paused",
            nextRunAt,
            retryScheduledFor: undefined,
          },
        };
      }
    }
  }

  // Expiry after N consecutive successful runs (--expires-after-runs). Mirrors
  // the circuit breaker: the streak counter resets on any final failure, treats
  // retryable failures and skipped runs as neutral, and the marker written by
  // the store transition is a watermark so a manual resume starts a fresh
  // streak. Independent of the time-based expiresAt.
  const expiresAfterRuns =
    typeof current.expiresAfterRuns === "number" ? Math.floor(current.expiresAfterRuns) : 0;
  if (run.status === "succeeded" && expiresAfterRuns > 0) {
    const successes = consecutiveSuccessCountFromRuns(input.recentRuns ?? [], current.maxAttempts);
    if (successes >= expiresAfterRuns) {
      const reason = `${EXPIRY_REASON_PREFIX}: ${successes} consecutive successful runs; loop expired (resume with 'loops resume ${current.name}' to start a fresh streak)`;
      return {
        kind: "expires_after_runs",
        successes,
        reason,
        markerScheduledFor: finishedAt.toISOString(),
        patch: {
          status: "expired",
          nextRunAt: undefined,
          retryScheduledFor: undefined,
        },
      };
    }
  }

  const nextRunAt = computeNextAfter(current.schedule, new Date(run.scheduledFor), finishedAt);
  return {
    kind: "update",
    reason: "recurrence",
    patch: {
      status: nextRunAt ? "active" : "stopped",
      nextRunAt,
      retryScheduledFor: undefined,
    },
  };
}
