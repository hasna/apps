import { describe, expect, test } from "bun:test";
import type { Loop, LoopRun } from "../types.js";
import {
  CIRCUIT_BREAKER_REASON_PREFIX,
  MAX_RETRY_DELAY_MS,
  consecutiveFailureCountFromRuns,
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
});
