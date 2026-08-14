import { describe, expect, test } from "bun:test";
import type { Loop, LoopRun } from "../types.js";
import {
  CIRCUIT_BREAKER_REASON_PREFIX,
  EXPIRY_REASON_PREFIX,
  MAX_RETRY_DELAY_MS,
  consecutiveFailureCountFromRuns,
  consecutiveSuccessCountFromRuns,
  planLoopAdvancement,
  retryBackoffDelayMs,
} from "./advancement.js";

function loopFixture(patch: Partial<Loop> = {}): Loop {
  return {
    id: "loop",
    name: "loop",
    status: "active",
    schedule: { type: "interval", everyMs: 60_000 },
    target: { type: "command", command: "true" },
    catchUp: "latest",
    catchUpLimit: 1,
    overlap: "skip",
    maxAttempts: 2,
    retryDelayMs: 1_000,
    leaseMs: 60_000,
    nextRunAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2025-12-31T00:00:00.000Z",
    updatedAt: "2025-12-31T00:00:00.000Z",
    ...patch,
  };
}

function runFixture(patch: Partial<LoopRun> = {}): LoopRun {
  return {
    id: "run",
    loopId: "loop",
    loopName: "loop",
    scheduledFor: "2026-01-01T00:00:00.000Z",
    attempt: 1,
    status: "failed",
    startedAt: "2026-01-01T00:00:01.000Z",
    error: "boom",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

describe("shared loop advancement policy", () => {
  test("keeps provider-aware jittered exponential backoff and the six-hour cap", () => {
    const loop = loopFixture({ retryDelayMs: 1_000 });
    expect(retryBackoffDelayMs(loop, runFixture({ error: "429 too many requests" }), () => 0.5)).toBe(4_000);
    expect(retryBackoffDelayMs(loop, runFixture({ attempt: 2 }), () => 0)).toBe(1_000);
    expect(retryBackoffDelayMs(loop, runFixture({ attempt: 2 }), () => 0.999999)).toBeLessThanOrEqual(3_000);
    expect(
      retryBackoffDelayMs(
        loopFixture({ retryDelayMs: 3_600_000 }),
        runFixture({ attempt: 20, error: "provider unavailable" }),
        () => 0.5,
      ),
    ).toBe(MAX_RETRY_DELAY_MS);
  });

  test("plans the same retry and deferred-retry mutations without storage access", () => {
    const retry = planLoopAdvancement({
      current: loopFixture(),
      run: runFixture(),
      finishedAt: new Date("2026-01-01T00:00:10.000Z"),
      succeeded: false,
      retryRandom: 0.5,
      recentRuns: [],
    });
    expect(retry).toEqual({
      kind: "update",
      reason: "retry",
      patch: {
        status: "active",
        nextRunAt: "2026-01-01T00:00:11.000Z",
        retryScheduledFor: "2026-01-01T00:00:00.000Z",
      },
    });

    const deferred = runFixture({
      id: "deferred",
      scheduledFor: "2026-01-01T00:01:00.000Z",
      attempt: 1,
      updatedAt: "2026-01-01T00:00:10.000Z",
    });
    const restore = planLoopAdvancement({
      current: loopFixture({ maxAttempts: 2 }),
      run: runFixture({ attempt: 2 }),
      finishedAt: new Date("2026-01-01T00:00:10.000Z"),
      succeeded: false,
      deferredRetry: deferred,
      retryRandom: 0.5,
      recentRuns: [],
    });
    expect(restore).toMatchObject({
      kind: "update",
      reason: "deferred_retry",
      patch: {
        nextRunAt: "2026-01-01T00:00:11.000Z",
        retryScheduledFor: deferred.scheduledFor,
      },
    });
  });

  test("terminal failed replay preserves an active retry timing across different jitter samples", () => {
    const run = runFixture();
    const first = planLoopAdvancement({
      current: loopFixture(),
      run,
      finishedAt: new Date("2026-01-01T00:00:10.000Z"),
      succeeded: false,
      retryRandom: 0,
    });
    expect(first).toMatchObject({
      kind: "update",
      reason: "retry",
      patch: {
        nextRunAt: "2026-01-01T00:00:10.500Z",
        retryScheduledFor: run.scheduledFor,
      },
    });

    const replay = planLoopAdvancement({
      current: loopFixture({
        nextRunAt: "2026-01-01T00:00:10.500Z",
        retryScheduledFor: run.scheduledFor,
      }),
      run,
      finishedAt: new Date("2026-01-01T00:00:10.000Z"),
      succeeded: false,
      retryRandom: 0.999999,
    });
    expect(replay).toEqual({ kind: "none", reason: "already_applied" });
  });

  test("a later failed attempt on the same slot advances backoff after the prior retry becomes due", () => {
    const run = runFixture({
      attempt: 2,
      startedAt: "2026-01-01T00:00:10.500Z",
      finishedAt: "2026-01-01T00:00:11.000Z",
    });
    expect(planLoopAdvancement({
      current: loopFixture({
        maxAttempts: 3,
        nextRunAt: "2026-01-01T00:00:10.500Z",
        retryScheduledFor: run.scheduledFor,
      }),
      run,
      finishedAt: new Date(run.finishedAt!),
      succeeded: false,
      retryRandom: 0.5,
    })).toMatchObject({
      kind: "update",
      reason: "retry",
      patch: {
        nextRunAt: "2026-01-01T00:00:13.000Z",
        retryScheduledFor: run.scheduledFor,
      },
    });
  });

  test("terminal failed replay repairs a matching retry intent when nextRunAt is missing", () => {
    const run = runFixture();
    expect(planLoopAdvancement({
      current: loopFixture({
        nextRunAt: undefined,
        retryScheduledFor: run.scheduledFor,
      }),
      run,
      finishedAt: new Date("2026-01-01T00:00:10.000Z"),
      succeeded: false,
      retryRandom: 0.5,
    })).toMatchObject({
      kind: "update",
      reason: "retry",
      patch: {
        nextRunAt: "2026-01-01T00:00:11.000Z",
        retryScheduledFor: run.scheduledFor,
      },
    });
  });

  test("guards inactive, archived, retry-intent, and reverse-order stale completions", () => {
    const run = runFixture({ status: "succeeded" });
    const common = {
      run,
      finishedAt: new Date("2026-01-01T00:00:10.000Z"),
      succeeded: true,
      recentRuns: [run],
    };
    expect(planLoopAdvancement({ ...common, current: loopFixture({ status: "paused" }) })).toMatchObject({ kind: "none", reason: "inactive" });
    expect(planLoopAdvancement({ ...common, current: loopFixture({ archivedAt: "2026-01-01T00:00:01.000Z" }) })).toMatchObject({ kind: "none", reason: "archived" });
    expect(planLoopAdvancement({
      ...common,
      current: loopFixture({ retryScheduledFor: "2026-01-01T00:01:00.000Z" }),
    })).toMatchObject({ kind: "none", reason: "stale" });
    expect(planLoopAdvancement({
      ...common,
      current: loopFixture({ nextRunAt: "2026-01-01T00:02:00.000Z" }),
    })).toMatchObject({ kind: "none", reason: "stale" });
  });

  test("preserves an older owed retry without regressing a newer scheduling cursor", () => {
    const olderFailure = runFixture({
      scheduledFor: "2026-01-01T00:00:00.000Z",
      attempt: 1,
    });
    expect(planLoopAdvancement({
      current: loopFixture({ nextRunAt: "2026-01-01T00:02:00.000Z" }),
      run: olderFailure,
      finishedAt: new Date("2026-01-01T00:01:10.000Z"),
      succeeded: false,
      retryRandom: 0.5,
    })).toEqual({
      kind: "update",
      reason: "retry",
      patch: {
        status: "active",
        nextRunAt: "2026-01-01T00:02:00.000Z",
        retryScheduledFor: olderFailure.scheduledFor,
      },
    });

    expect(planLoopAdvancement({
      current: loopFixture({
        nextRunAt: "2026-01-01T00:03:00.000Z",
        retryScheduledFor: "2026-01-01T00:01:00.000Z",
      }),
      run: olderFailure,
      finishedAt: new Date("2026-01-01T00:01:10.000Z"),
      succeeded: false,
      retryRandom: 0.5,
    })).toEqual({ kind: "none", reason: "stale" });
  });

  test("selects the globally earliest deferred retry over a newer active retry intent", () => {
    const olderFailure = runFixture({
      id: "older",
      scheduledFor: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      updatedAt: "2026-01-01T00:00:02.000Z",
    });
    const newerFailure = runFixture({
      id: "newer",
      scheduledFor: "2026-01-01T00:01:00.000Z",
      startedAt: "2026-01-01T00:01:01.000Z",
      updatedAt: "2026-01-01T00:01:02.000Z",
    });
    expect(planLoopAdvancement({
      current: loopFixture({
        nextRunAt: "2026-01-01T00:01:03.000Z",
        retryScheduledFor: newerFailure.scheduledFor,
      }),
      run: newerFailure,
      finishedAt: new Date(newerFailure.updatedAt),
      succeeded: false,
      deferredRetry: olderFailure,
      retryRandom: 0.5,
    })).toEqual({
      kind: "update",
      reason: "deferred_retry",
      patch: {
        status: "active",
        nextRunAt: "2026-01-01T00:01:03.000Z",
        retryScheduledFor: olderFailure.scheduledFor,
      },
    });
  });

  test("does not replace an earlier retry intent while that retry attempt is running", () => {
    const runningRetry = runFixture({
      id: "running",
      status: "running",
      scheduledFor: "2026-01-01T00:00:00.000Z",
    });
    const laterFailure = runFixture({
      id: "later",
      scheduledFor: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:01:02.000Z",
    });
    expect(planLoopAdvancement({
      current: loopFixture({
        nextRunAt: "2026-01-01T00:00:03.000Z",
        retryScheduledFor: runningRetry.scheduledFor,
      }),
      run: laterFailure,
      finishedAt: new Date(laterFailure.updatedAt),
      succeeded: false,
      deferredRetry: laterFailure,
      retryIntentRun: runningRetry,
      retryRandom: 0.5,
    })).toEqual({ kind: "none", reason: "stale" });
  });

  test("counts final-failure streaks, respects the marker watermark, and plans a breaker", () => {
    const failures = [
      runFixture({ id: "f3", attempt: 2, scheduledFor: "2026-01-01T00:02:00.000Z" }),
      runFixture({ id: "f2", attempt: 2, scheduledFor: "2026-01-01T00:01:00.000Z" }),
      runFixture({ id: "f1", attempt: 2, scheduledFor: "2026-01-01T00:00:00.000Z" }),
    ];
    expect(consecutiveFailureCountFromRuns(failures, 2)).toBe(3);
    const plan = planLoopAdvancement({
      current: loopFixture({ maxAttempts: 2, nextRunAt: "2026-01-01T00:02:00.000Z" }),
      run: failures[0]!,
      finishedAt: new Date("2026-01-01T00:02:10.000Z"),
      succeeded: false,
      recentRuns: failures,
      circuitBreakerThreshold: 3,
    });
    expect(plan).toMatchObject({
      kind: "circuit_breaker",
      failures: 3,
      patch: { status: "paused", retryScheduledFor: undefined },
    });

    const marker = runFixture({
      id: "marker",
      status: "skipped",
      scheduledFor: "2026-01-01T00:02:10.000Z",
      error: `${CIRCUIT_BREAKER_REASON_PREFIX}: prior`,
    });
    expect(consecutiveFailureCountFromRuns([marker, ...failures], 2)).toBe(0);
  });

  test("treats configured skips as neutral for retries, recurrence, and failure streaks", () => {
    const skipped = runFixture({
      id: "configured-skip",
      status: "skipped",
      attempt: 1,
      scheduledFor: "2026-01-01T00:02:00.000Z",
      exitCode: 75,
      error: "process exited with code 75",
    });
    const priorFailure = runFixture({
      id: "prior-failure",
      attempt: 2,
      scheduledFor: "2026-01-01T00:01:00.000Z",
    });

    expect(consecutiveFailureCountFromRuns([skipped], 2)).toBe(0);
    expect(consecutiveFailureCountFromRuns([skipped, priorFailure], 2)).toBe(1);
    expect(planLoopAdvancement({
      current: loopFixture({ maxAttempts: 2, nextRunAt: skipped.scheduledFor }),
      run: skipped,
      finishedAt: new Date("2026-01-01T00:02:10.000Z"),
      succeeded: false,
      recentRuns: [skipped, priorFailure],
      circuitBreakerThreshold: 1,
    })).toEqual({
      kind: "update",
      reason: "recurrence",
      patch: {
        status: "active",
        nextRunAt: "2026-01-01T00:03:00.000Z",
        retryScheduledFor: undefined,
      },
    });
  });

  test("does not open the breaker for transient Bun signal-exit interop failures", () => {
    const interopError =
      "SyntaxError: Missing 'default' export in module /home/hasna/.bun/install/global/node_modules/signal-exit/dist/mjs/index.js";
    const failures = [
      runFixture({ id: "f3", attempt: 2, scheduledFor: "2026-01-01T00:02:00.000Z", stderr: interopError }),
      runFixture({ id: "f2", attempt: 2, scheduledFor: "2026-01-01T00:01:00.000Z", stderr: interopError }),
      runFixture({ id: "f1", attempt: 2, scheduledFor: "2026-01-01T00:00:00.000Z", stderr: interopError }),
    ];

    expect(consecutiveFailureCountFromRuns(failures, 2)).toBe(0);
    expect(planLoopAdvancement({
      current: loopFixture({ maxAttempts: 2, nextRunAt: "2026-01-01T00:02:00.000Z" }),
      run: failures[0]!,
      finishedAt: new Date("2026-01-01T00:02:10.000Z"),
      succeeded: false,
      recentRuns: failures,
      circuitBreakerThreshold: 3,
    })).toMatchObject({
      kind: "update",
      reason: "recurrence",
      patch: { status: "active" },
    });
  });

  test("counts consecutive successes, resets on a final failure, and keeps retryable/skipped runs neutral", () => {
    const successes = [
      runFixture({ id: "s3", status: "succeeded", scheduledFor: "2026-01-01T00:02:00.000Z" }),
      runFixture({ id: "s2", status: "succeeded", scheduledFor: "2026-01-01T00:01:00.000Z" }),
      runFixture({ id: "s1", status: "succeeded", scheduledFor: "2026-01-01T00:00:00.000Z" }),
    ];
    expect(consecutiveSuccessCountFromRuns(successes, 1)).toBe(3);
    expect(consecutiveSuccessCountFromRuns(successes, 2)).toBe(3);

    // A final failure (attempt >= maxAttempts) resets the streak when it is
    // the newest run; an older failure does not retroactively break a streak
    // that has since resumed.
    const failure = runFixture({ id: "f1", attempt: 2, scheduledFor: "2026-01-01T00:03:00.000Z" });
    expect(consecutiveSuccessCountFromRuns([failure, successes[0]!, successes[1]!], 2)).toBe(0);
    expect(consecutiveSuccessCountFromRuns([successes[0]!, successes[1]!, failure], 2)).toBe(2);

    // A retryable failure (attempt < maxAttempts) is neutral and keeps counting.
    const retryable = runFixture({ id: "r1", attempt: 1, scheduledFor: "2026-01-01T00:01:00.000Z" });
    expect(consecutiveSuccessCountFromRuns([successes[0]!, retryable, successes[1]!], 2)).toBe(2);

    // Skipped runs are neutral: they neither count nor reset.
    const skipped = runFixture({ id: "skip", status: "skipped", scheduledFor: "2026-01-01T00:01:00.000Z" });
    expect(consecutiveSuccessCountFromRuns([successes[0]!, skipped, successes[1]!], 2)).toBe(2);

    // The expiry marker is a watermark: a manual resume starts a fresh streak.
    const marker = runFixture({
      id: "expiry-marker",
      status: "skipped",
      scheduledFor: "2026-01-01T00:02:10.000Z",
      error: `${EXPIRY_REASON_PREFIX}: prior`,
    });
    expect(consecutiveSuccessCountFromRuns([marker, ...successes], 2)).toBe(0);
  });

  test("plans expiry after N consecutive successful runs and keeps recurrence otherwise", () => {
    const successes = [
      runFixture({ id: "s3", status: "succeeded", scheduledFor: "2026-01-01T00:02:00.000Z" }),
      runFixture({ id: "s2", status: "succeeded", scheduledFor: "2026-01-01T00:01:00.000Z" }),
      runFixture({ id: "s1", status: "succeeded", scheduledFor: "2026-01-01T00:00:00.000Z" }),
    ];
    const plan = planLoopAdvancement({
      current: loopFixture({ expiresAfterRuns: 3, maxAttempts: 1, nextRunAt: "2026-01-01T00:02:00.000Z" }),
      run: successes[0]!,
      finishedAt: new Date("2026-01-01T00:02:10.000Z"),
      succeeded: true,
      recentRuns: successes,
    });
    expect(plan).toMatchObject({
      kind: "expires_after_runs",
      successes: 3,
      markerScheduledFor: "2026-01-01T00:02:10.000Z",
      patch: { status: "expired", nextRunAt: undefined, retryScheduledFor: undefined },
    });
    expect(plan.kind === "expires_after_runs" && plan.reason).toContain(EXPIRY_REASON_PREFIX);

    // Below the ceiling the loop keeps recurring.
    const below = planLoopAdvancement({
      current: loopFixture({ expiresAfterRuns: 3, maxAttempts: 1, nextRunAt: "2026-01-01T00:02:00.000Z" }),
      run: successes[0]!,
      finishedAt: new Date("2026-01-01T00:02:10.000Z"),
      succeeded: true,
      recentRuns: successes.slice(0, 2),
    });
    expect(below).toMatchObject({
      kind: "update",
      reason: "recurrence",
      patch: { status: "active", nextRunAt: "2026-01-01T00:03:00.000Z" },
    });

    // Without expiresAfterRuns, successes never expire the loop.
    const unset = planLoopAdvancement({
      current: loopFixture({ maxAttempts: 1, nextRunAt: "2026-01-01T00:02:00.000Z" }),
      run: successes[0]!,
      finishedAt: new Date("2026-01-01T00:02:10.000Z"),
      succeeded: true,
      recentRuns: successes,
    });
    expect(unset).toMatchObject({ kind: "update", reason: "recurrence" });

    // A skipped run is neutral for expiry: the plan stays a recurrence.
    const skipped = runFixture({ id: "skip", status: "skipped", scheduledFor: "2026-01-01T00:02:00.000Z" });
    const skippedPlan = planLoopAdvancement({
      current: loopFixture({ expiresAfterRuns: 1, maxAttempts: 1, nextRunAt: "2026-01-01T00:02:00.000Z" }),
      run: skipped,
      finishedAt: new Date("2026-01-01T00:02:10.000Z"),
      succeeded: false,
      recentRuns: [skipped],
    });
    expect(skippedPlan).toMatchObject({ kind: "update", reason: "recurrence" });

    // A failure on the final run resets the streak instead of expiring.
    const failed = runFixture({ id: "f3", attempt: 1, scheduledFor: "2026-01-01T00:02:00.000Z" });
    const failedPlan = planLoopAdvancement({
      current: loopFixture({ expiresAfterRuns: 3, maxAttempts: 1, nextRunAt: "2026-01-01T00:02:00.000Z" }),
      run: failed,
      finishedAt: new Date("2026-01-01T00:02:10.000Z"),
      succeeded: false,
      recentRuns: [failed, ...successes],
    });
    expect(failedPlan).toMatchObject({ kind: "update", reason: "recurrence" });
  });
});
