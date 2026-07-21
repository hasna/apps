import type { Loop, LoopRun } from "../types.js";
import { classifyRunFailure } from "./health.js";
import { computeNextAfter } from "./recurrence.js";

export const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 5;
export const CIRCUIT_BREAKER_REASON_PREFIX = "circuit breaker open";
const THROTTLED_RETRY_MULTIPLIER = 4;
const MAX_RETRY_EXPONENT = 20;

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
 * Retryable failures are neutral, a success resets the streak, and the newest
 * circuit-breaker marker is a watermark so a manual resume starts a fresh
 * streak.
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
  let count = 0;
  for (const run of runs) {
    if (run.status === "running" || run.status === "skipped") continue;
    if (watermark !== undefined && new Date(run.scheduledFor).getTime() <= watermark) continue;
    if (run.status === "succeeded") break;
    if (run.attempt < maxAttempts) continue;
    count += 1;
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
  const { current, run, finishedAt, succeeded } = input;
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
    const retryAt = nextAfterRetry(
      current,
      deferredRetry,
      deferredRetry.id === run.id ? finishedAt : new Date(deferredRetry.updatedAt),
      input.retryRandom,
    );
    return {
      kind: "update",
      reason: deferredRetry.id === run.id ? "retry" : "deferred_retry",
      patch: {
        status: "active",
        nextRunAt: withoutCursorRegression(current, retryAt),
        retryScheduledFor: deferredRetry.scheduledFor,
      },
    };
  }

  if (!succeeded && run.attempt < current.maxAttempts) {
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

  if (!succeeded) {
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
