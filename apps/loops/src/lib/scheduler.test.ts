import { describe, expect, test } from "bun:test";
import type { ExecutorResult, Loop, LoopRun } from "../types.js";
import { buildHealthReport } from "./health.js";
import {
  advanceLoop,
  CIRCUIT_BREAKER_REASON_PREFIX,
  claimDueRuns,
  consecutiveFailureCount,
  executeClaimedRun,
  inlineRunnerOwnerPid,
  loopLane,
  manualRunScheduledFor,
  manualRunSource,
  MAX_RETRY_DELAY_MS,
  MAX_SKIPS_PER_LOOP_PER_TICK,
  retryBackoffDelayMs,
  shouldAdvanceManualRun,
  tick,
} from "./scheduler.js";
import { Store } from "./store.js";

function result(status: ExecutorResult["status"], at: string, error = "boom"): ExecutorResult {
  return {
    status,
    exitCode: status === "succeeded" ? 0 : 1,
    stdout: "ok",
    stderr: "",
    error: status === "succeeded" ? undefined : error,
    startedAt: at,
    finishedAt: at,
    durationMs: 0,
  };
}

// jitter factor is 0.5 + random, so random 0.5 yields exactly the base delay
const noJitter = (): number => 0.5;

function loopFixture(patch: Partial<Loop> = {}): Loop {
  return {
    id: "loop",
    name: "loop",
    status: "active",
    schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
    target: { type: "command", command: "true" },
    catchUp: "latest",
    catchUpLimit: 1,
    overlap: "skip",
    maxAttempts: 2,
    retryDelayMs: 1_000,
    leaseMs: 60_000,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
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
    error: "boom",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

describe("scheduler", () => {
  test("inlineRunnerOwnerPid recognizes every inline runner-id shape", () => {
    // CLI run-now, CLI tick, SDK default, and caller-supplied SDK ids.
    expect(inlineRunnerOwnerPid("manual:1234")).toBe(1234);
    expect(inlineRunnerOwnerPid("manual-tick:1234")).toBe(1234);
    expect(inlineRunnerOwnerPid("sdk:1234")).toBe(1234);
    expect(inlineRunnerOwnerPid("my-app:1234")).toBe(1234);
    // Daemon runner ids (`${hostname}:${pid}:${leaseId}`) and unknown shapes
    // never match, so daemon-owned runs stay reapable.
    expect(inlineRunnerOwnerPid("host:1234:abc123def")).toBeUndefined();
    expect(inlineRunnerOwnerPid("runner")).toBeUndefined();
    expect(inlineRunnerOwnerPid("sdk:notapid")).toBeUndefined();
    expect(inlineRunnerOwnerPid(undefined)).toBeUndefined();
  });

  test("runs a due once loop and stops it", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "once",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const out = await tick({
        store,
        runnerId: "test",
        now: () => new Date("2026-01-01T00:00:00Z"),
        execute: async () => result("succeeded", "2026-01-01T00:00:00.000Z"),
      });
      expect(out.completed).toHaveLength(1);
      expect(out.completed[0]?.status).toBe("succeeded");
      expect(store.getLoop(loop.id)?.status).toBe("stopped");
    } finally {
      store.close();
    }
  });

  test("does not schedule archived loops", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "archived-due",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const archived = store.archiveLoop(loop.id);
      const out = await tick({
        store,
        runnerId: "test",
        now: () => new Date("2026-01-01T00:00:00Z"),
        execute: async () => result("succeeded", "2026-01-01T00:00:00.000Z"),
      });
      expect(out.completed).toHaveLength(0);
      expect(out.claimed).toHaveLength(0);
      expect(store.listRuns({ loopId: loop.id })).toHaveLength(0);
      expect(store.getLoop(loop.id)?.archivedAt).toBe(archived.archivedAt);
      expect(manualRunSource(archived, manualRunScheduledFor(archived, new Date("2026-01-01T00:00:00Z")), new Date("2026-01-01T00:00:00Z"))).toBe("ad_hoc");
      expect(shouldAdvanceManualRun(archived, archived.nextRunAt!, new Date("2026-01-01T00:00:00Z"))).toBe(false);
    } finally {
      store.close();
    }
  });

  test("retries failed slots without advancing recurrence", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "retry",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          maxAttempts: 2,
          retryDelayMs: 1_000,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      await tick({
        store,
        runnerId: "test",
        now: () => new Date("2026-01-01T00:00:00Z"),
        random: noJitter,
        execute: async () => result("failed", "2026-01-01T00:00:00.000Z"),
      });
      const afterFail = store.getLoop(loop.id);
      expect(afterFail?.retryScheduledFor).toBe("2026-01-01T00:00:00.000Z");
      expect(afterFail?.nextRunAt).toBe("2026-01-01T00:00:01.000Z");
      await tick({
        store,
        runnerId: "test",
        now: () => new Date("2026-01-01T00:00:01Z"),
        random: noJitter,
        execute: async () => result("succeeded", "2026-01-01T00:00:01.000Z"),
      });
      const run = store.listRuns({ loopId: loop.id })[0];
      expect(run?.attempt).toBe(2);
      expect(run?.status).toBe("succeeded");
      expect(store.getLoop(loop.id)?.status).toBe("stopped");
    } finally {
      store.close();
    }
  });

  test("advances interval loops after abandoned run recovery", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "abandoned",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const firstSlot = loop.nextRunAt!;
      store.claimRun(loop, firstSlot, "test", new Date(firstSlot));
      const out = await tick({
        store,
        runnerId: "test",
        now: () => new Date(new Date(firstSlot).getTime() + 1_000),
        execute: async () => result("succeeded", "2026-01-01T00:00:02.000Z"),
      });
      expect(out.recovered).toHaveLength(1);
      expect(store.getLoop(loop.id)?.nextRunAt).not.toBe(firstSlot);
      expect(store.getRunBySlot(loop.id, firstSlot)?.status).toBe("abandoned");
    } finally {
      store.close();
    }
  });

  test("stale daemon tick cannot recover expired runs or advance loop cursor after database lease loss", async () => {
    const store = new Store(":memory:");
    try {
      expect(
        store.acquireDaemonLease({
          id: "daemon",
          pid: 1,
          hostname: "host",
          ttlMs: 60_000,
          now: new Date("2026-01-01T00:00:00Z"),
        })?.id,
      ).toBe("daemon");
      const loop = store.createLoop(
        {
          name: "stale-daemon-recovery",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          maxAttempts: 2,
          retryDelayMs: 5_000,
          leaseMs: 10,
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const firstSlot = loop.nextRunAt!;
      const claim = store.claimRun(loop, firstSlot, "daemon-runner", new Date(firstSlot), { daemonLeaseId: "daemon" });
      expect(claim).toBeDefined();

      store.releaseDaemonLease("daemon");
      const out = await tick({
        store,
        runnerId: "daemon-runner",
        daemonLeaseId: "daemon",
        now: () => new Date(new Date(firstSlot).getTime() + 1_000),
        execute: async () => result("succeeded", "2026-01-01T00:00:01.000Z"),
      });

      expect(out.recovered).toHaveLength(0);
      expect(out.completed).toHaveLength(0);
      expect(store.getRun(claim!.run.id)?.status).toBe("running");
      expect(store.getLoop(loop.id)?.retryScheduledFor).toBeUndefined();
      expect(store.getLoop(loop.id)?.nextRunAt).toBe(firstSlot);
    } finally {
      store.close();
    }
  });

  test("claim budget counts only executed runs; overlap skips cannot starve other due loops", () => {
    const store = new Store(":memory:");
    try {
      // skipper sorts first in dueLoops (earlier nextRunAt) and can only
      // produce overlap-skip bookkeeping; runnable must still get the claim.
      const skipper = store.createLoop(
        {
          name: "overlap-skipper",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          overlap: "skip",
          leaseMs: 10 * 60_000,
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      expect(store.claimRun(skipper, "2026-01-01T00:00:00.000Z", "active", new Date("2026-01-01T00:00:00Z"))).toBeDefined();
      store.updateLoop(skipper.id, { nextRunAt: "2026-01-01T00:00:30.000Z" });
      const runnable = store.createLoop(
        {
          name: "runnable",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        },
        new Date("2026-01-01T00:00:00Z"),
      );

      const out = claimDueRuns({
        store,
        runnerId: "daemon",
        maxClaims: 1,
        now: () => new Date("2026-01-01T00:01:00Z"),
      });

      expect(out.claims).toHaveLength(1);
      expect(out.claims[0]?.loop.id).toBe(runnable.id);
      expect(out.skipped).toHaveLength(1);
      expect(out.skipped[0]?.loopId).toBe(skipper.id);
      expect(store.listRuns({ status: "skipped" })).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("caps overlap-skip bookkeeping per loop per tick", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "skip-cap",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          overlap: "skip",
          catchUp: "all",
          catchUpLimit: 50,
          leaseMs: 10 * 60_000,
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const firstSlot = loop.nextRunAt!;
      expect(store.claimRun(loop, firstSlot, "active", new Date(firstSlot))).toBeDefined();

      const out = claimDueRuns({
        store,
        runnerId: "daemon",
        now: () => new Date(new Date(firstSlot).getTime() + 30_000),
      });

      expect(out.claims).toHaveLength(0);
      expect(out.skipped).toHaveLength(MAX_SKIPS_PER_LOOP_PER_TICK);
      expect(store.listRuns({ loopId: loop.id, status: "skipped" })).toHaveLength(MAX_SKIPS_PER_LOOP_PER_TICK);
    } finally {
      store.close();
    }
  });

  test("catch_up all stops processing later slots when an earlier slot needs retry", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "catch-up-retry",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          catchUp: "all",
          catchUpLimit: 10,
          maxAttempts: 2,
          retryDelayMs: 5_000,
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const firstSlot = loop.nextRunAt!;
      const out = await tick({
        store,
        runnerId: "test",
        now: () => new Date("2026-01-01T00:00:05Z"),
        random: noJitter,
        execute: async () => result("failed", "2026-01-01T00:00:05.000Z"),
      });

      expect(out.completed).toHaveLength(1);
      expect(store.listRuns({ loopId: loop.id })).toHaveLength(1);
      const updated = store.getLoop(loop.id);
      expect(updated?.retryScheduledFor).toBe(firstSlot);
      expect(updated?.nextRunAt).toBe("2026-01-01T00:00:10.000Z");
    } finally {
      store.close();
    }
  });

  test("preserves retry intent for recovered abandoned runs before advancing later recovered slots", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "recovered-retry",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          catchUp: "all",
          catchUpLimit: 10,
          maxAttempts: 2,
          retryDelayMs: 5_000,
          leaseMs: 1_000,
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const firstSlot = loop.nextRunAt!;
      const secondSlot = "2026-01-01T00:00:02.000Z";

      expect(store.claimRun(loop, firstSlot, "runner", new Date("2026-01-01T00:00:01Z"))).toBeDefined();
      const secondAttemptOne = store.claimRun(loop, secondSlot, "runner", new Date("2026-01-01T00:00:02Z"));
      expect(secondAttemptOne).toBeDefined();
      store.finalizeRun(
        secondAttemptOne!.run.id,
        {
          status: "failed",
          finishedAt: "2026-01-01T00:00:02.100Z",
          durationMs: 100,
          stdout: "",
          stderr: "",
          error: "first failed",
        },
        { claimedBy: "runner", now: new Date("2026-01-01T00:00:02.100Z") },
      );
      expect(store.claimRun(loop, secondSlot, "runner", new Date("2026-01-01T00:00:02.200Z"))?.run.attempt).toBe(2);

      const out = await tick({
        store,
        runnerId: "tick",
        now: () => new Date("2026-01-01T00:00:10Z"),
        random: noJitter,
        execute: async () => result("succeeded", "2026-01-01T00:00:10.000Z"),
      });

      expect(out.recovered).toHaveLength(2);
      const updated = store.getLoop(loop.id);
      expect(updated?.retryScheduledFor).toBe(firstSlot);
      expect(updated?.nextRunAt).toBe("2026-01-01T00:00:15.000Z");
      expect(store.getRunBySlot(loop.id, firstSlot)?.status).toBe("abandoned");
      expect(store.getRunBySlot(loop.id, secondSlot)?.status).toBe("abandoned");
    } finally {
      store.close();
    }
  });

  test("chains retryable recovered abandoned runs after the first recovered retry succeeds", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "recovered-retry-chain",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          catchUp: "all",
          catchUpLimit: 10,
          maxAttempts: 2,
          retryDelayMs: 5_000,
          leaseMs: 1_000,
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const firstSlot = loop.nextRunAt!;
      const secondSlot = "2026-01-01T00:00:02.000Z";

      expect(store.claimRun(loop, firstSlot, "runner", new Date("2026-01-01T00:00:01Z"))).toBeDefined();
      expect(store.claimRun(loop, secondSlot, "runner", new Date("2026-01-01T00:00:02Z"))).toBeDefined();

      await tick({
        store,
        runnerId: "recover",
        now: () => new Date("2026-01-01T00:00:10Z"),
        random: noJitter,
        execute: async () => result("succeeded", "2026-01-01T00:00:10.000Z"),
      });

      expect(store.getLoop(loop.id)?.retryScheduledFor).toBe(firstSlot);
      expect(store.getLoop(loop.id)?.nextRunAt).toBe("2026-01-01T00:00:15.000Z");

      await tick({
        store,
        runnerId: "retry-first",
        now: () => new Date("2026-01-01T00:00:15Z"),
        random: noJitter,
        execute: async () => result("succeeded", "2026-01-01T00:00:15.000Z"),
      });

      expect(store.getRunBySlot(loop.id, firstSlot)?.status).toBe("succeeded");
      expect(store.getRunBySlot(loop.id, firstSlot)?.attempt).toBe(2);
      expect(store.getLoop(loop.id)?.retryScheduledFor).toBe(secondSlot);
      expect(store.getLoop(loop.id)?.nextRunAt).toBe("2026-01-01T00:00:20.000Z");

      await tick({
        store,
        runnerId: "retry-second",
        now: () => new Date("2026-01-01T00:00:20Z"),
        random: noJitter,
        execute: async () => result("succeeded", "2026-01-01T00:00:20.000Z"),
      });

      expect(store.getRunBySlot(loop.id, secondSlot)?.status).toBe("succeeded");
      expect(store.getRunBySlot(loop.id, secondSlot)?.attempt).toBe(2);
      expect(store.getLoop(loop.id)?.retryScheduledFor).toBeUndefined();
      expect(store.getLoop(loop.id)?.nextRunAt).toBe("2026-01-01T00:00:21.000Z");
    } finally {
      store.close();
    }
  });

  test("classifies manual run sources for ad hoc, due, and retry slots", () => {
    const base = {
      id: "loop",
      name: "loop",
      status: "active" as const,
      schedule: { type: "once" as const, at: "2026-01-01T00:00:00Z" },
      target: { type: "command" as const, command: "true" },
      catchUp: "latest" as const,
      catchUpLimit: 1,
      overlap: "skip" as const,
      maxAttempts: 2,
      retryDelayMs: 1_000,
      leaseMs: 60_000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    expect(manualRunSource({ ...base, nextRunAt: "2026-01-01T00:10:00.000Z" }, "2026-01-01T00:00:00.000Z", new Date("2026-01-01T00:00:00Z"))).toBe("ad_hoc");
    expect(manualRunSource({ ...base, nextRunAt: "2026-01-01T00:00:00.000Z" }, "2026-01-01T00:00:00.000Z", new Date("2026-01-01T00:00:01Z"))).toBe("due_slot");
    expect(manualRunSource({ ...base, nextRunAt: "2026-01-01T00:00:10.000Z", retryScheduledFor: "2026-01-01T00:00:00.000Z" }, "2026-01-01T00:00:00.000Z", new Date("2026-01-01T00:00:10Z"))).toBe("retry_slot");
  });

  test("manual run-now on a paused due loop uses an ad hoc slot and leaves the due cursor recoverable after resume", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "paused-due",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const paused = store.updateLoop(loop.id, { status: "paused" });
      const now = new Date("2026-01-02T00:00:00Z");
      const manualSlot = manualRunScheduledFor(paused, now);
      expect(manualSlot).toBe("2026-01-02T00:00:00.000Z");
      expect(manualRunSource(paused, manualSlot, now)).toBe("ad_hoc");
      expect(shouldAdvanceManualRun(paused, manualSlot, now)).toBe(false);

      const claim = store.claimRun(paused, manualSlot, "manual", now);
      expect(claim).toBeDefined();
      const manual = await executeClaimedRun({
        store,
        runnerId: "manual",
        loop: claim!.loop,
        run: claim!.run,
        execute: async () => result("succeeded", "2026-01-02T00:00:00.000Z"),
      });
      expect(manual.status).toBe("succeeded");
      expect(store.getLoop(loop.id)?.nextRunAt).toBe("2026-01-01T00:00:00.000Z");

      store.updateLoop(loop.id, { status: "active" });
      await tick({
        store,
        runnerId: "daemon",
        now: () => new Date("2026-01-02T00:00:01Z"),
        execute: async () => result("succeeded", "2026-01-02T00:00:01.000Z"),
      });

      expect(store.getRunBySlot(loop.id, "2026-01-01T00:00:00.000Z")?.status).toBe("succeeded");
      expect(store.getLoop(loop.id)?.status).toBe("stopped");
    } finally {
      store.close();
    }
  });

  test("retry backoff grows exponentially per attempt", () => {
    const loop = loopFixture({ retryDelayMs: 1_000, maxAttempts: 5 });
    const delays = [1, 2, 3, 4].map((attempt) => retryBackoffDelayMs(loop, runFixture({ attempt }), noJitter));
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  test("retry backoff jitter stays within half and one-and-a-half of the exponential delay", () => {
    const loop = loopFixture({ retryDelayMs: 1_000 });
    const run = runFixture({ attempt: 2 });
    expect(retryBackoffDelayMs(loop, run, () => 0)).toBe(1_000);
    expect(retryBackoffDelayMs(loop, run, () => 0.999999)).toBeGreaterThanOrEqual(2_999);
    expect(retryBackoffDelayMs(loop, run, () => 0.999999)).toBeLessThanOrEqual(3_000);
    for (const random of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const delay = retryBackoffDelayMs(loop, run, () => random);
      expect(delay).toBeGreaterThanOrEqual(1_000);
      expect(delay).toBeLessThanOrEqual(3_000);
    }
  });

  test("rate-limit and auth failures back off harder and everything caps at six hours", () => {
    const loop = loopFixture({ retryDelayMs: 1_000 });
    expect(retryBackoffDelayMs(loop, runFixture({ error: "429 too many requests" }), noJitter)).toBe(4_000);
    expect(retryBackoffDelayMs(loop, runFixture({ error: "invalid token" }), noJitter)).toBe(4_000);
    expect(retryBackoffDelayMs(loop, runFixture({ error: "boom" }), noJitter)).toBe(1_000);
    const slow = loopFixture({ retryDelayMs: 3_600_000 });
    expect(retryBackoffDelayMs(slow, runFixture({ attempt: 10, error: "429 too many requests" }), noJitter)).toBe(MAX_RETRY_DELAY_MS);
    expect(MAX_RETRY_DELAY_MS).toBe(6 * 60 * 60 * 1000);
  });

  test("failed retries back off exponentially across tick attempts", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "backoff",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          maxAttempts: 3,
          retryDelayMs: 1_000,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      await tick({
        store,
        runnerId: "test",
        now: () => new Date("2026-01-01T00:00:00Z"),
        random: noJitter,
        execute: async () => result("failed", "2026-01-01T00:00:00.000Z"),
      });
      expect(store.getLoop(loop.id)?.nextRunAt).toBe("2026-01-01T00:00:01.000Z");
      await tick({
        store,
        runnerId: "test",
        now: () => new Date("2026-01-01T00:00:01Z"),
        random: noJitter,
        execute: async () => result("failed", "2026-01-01T00:00:01.000Z"),
      });
      // second failed attempt doubles the delay: 1s * 2^(2-1)
      expect(store.getLoop(loop.id)?.nextRunAt).toBe("2026-01-01T00:00:03.000Z");
      expect(store.listRuns({ loopId: loop.id })[0]?.attempt).toBe(2);
    } finally {
      store.close();
    }
  });

  test("circuit breaker pauses a loop after consecutive final failures and manual resume clears it", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "breaker",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          catchUp: "none",
          maxAttempts: 1,
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const failingTick = async (): Promise<void> => {
        // run rows are ordered by created_at (wall clock, ms); keep ticks on
        // distinct milliseconds so streak ordering is deterministic
        await Bun.sleep(2);
        const due = store.getLoop(loop.id)!.nextRunAt!;
        await tick({
          store,
          runnerId: "test",
          now: () => new Date(due),
          random: noJitter,
          circuitBreakerThreshold: (candidate) => (candidate.id === loop.id ? 3 : undefined),
          execute: async () => result("failed", due),
        });
      };

      await failingTick();
      await failingTick();
      expect(consecutiveFailureCount(store, loop.id)).toBe(2);
      expect(store.getLoop(loop.id)?.status).toBe("active");

      await failingTick();
      const tripped = store.getLoop(loop.id);
      expect(tripped?.status).toBe("paused");
      expect(tripped?.nextRunAt).toBeDefined();
      const marker = store.listRuns({ loopId: loop.id, status: "skipped" })[0];
      expect(marker?.error?.startsWith(CIRCUIT_BREAKER_REASON_PREFIX)).toBe(true);
      expect(marker?.error).toContain("3 consecutive failed runs");

      // health surfaces the open breaker while paused
      const pausedReport = buildHealthReport(store);
      const pausedExpectation = pausedReport.expectations.find((entry) => entry.loop.id === loop.id);
      expect(pausedExpectation?.ok).toBe(false);
      expect(pausedExpectation?.failure?.classification).toBe("circuit_breaker");
      expect(pausedReport.classifications.circuit_breaker).toBe(1);

      // manual resume clears the breaker; health stops flagging the marker
      store.updateLoop(loop.id, { status: "active" });
      const resumedReport = buildHealthReport(store);
      const resumedExpectation = resumedReport.expectations.find((entry) => entry.loop.id === loop.id);
      expect(resumedExpectation?.ok).toBe(true);
      expect(resumedExpectation?.check.status).toBe("warn");

      // the marker resets the streak, so one fresh failure does not re-trip
      expect(consecutiveFailureCount(store, loop.id)).toBe(0);
      await failingTick();
      expect(consecutiveFailureCount(store, loop.id)).toBe(1);
      expect(store.getLoop(loop.id)?.status).toBe("active");
    } finally {
      store.close();
    }
  });

  test("circuit breaker does not trip while deferred backlog retries are owed", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "breaker-deferred",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          catchUp: "all",
          catchUpLimit: 10,
          overlap: "allow",
          maxAttempts: 2,
          retryDelayMs: 1,
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const failAllClaims = async (now: Date): Promise<LoopRun[]> => {
        const { claims } = claimDueRuns({ store, runnerId: "test", now: () => now, random: noJitter });
        const finals: LoopRun[] = [];
        for (const claim of claims) {
          // keep run rows on distinct created_at milliseconds for ordering
          await Bun.sleep(2);
          const final = await executeClaimedRun({
            store,
            runnerId: "test",
            loop: claim.loop,
            run: claim.run,
            now: () => now,
            execute: async () => result("failed", claim.run.scheduledFor),
          });
          advanceLoop(store, claim.loop, final, now, false, { random: noJitter, circuitBreakerThreshold: 5 });
          finals.push(final);
        }
        return finals;
      };

      // Backlog of five slots, each failing on attempt 1 (all retryable).
      let now = new Date("2026-01-01T00:00:05.500Z");
      const firstRound = await failAllClaims(now);
      expect(firstRound).toHaveLength(5);
      // Attempt-1 failures are pending retries, not final failures.
      expect(consecutiveFailureCount(store, loop.id, loop.maxAttempts)).toBe(0);
      const afterBacklog = store.getLoop(loop.id)!;
      expect(afterBacklog.status).toBe("active");
      expect(afterBacklog.retryScheduledFor).toBe(firstRound[0]!.scheduledFor);

      // Each deferred slot gets its promised final attempt; the breaker must
      // not trip (dropping owed retries) until the last final failure.
      for (let round = 0; round < 5; round++) {
        now = new Date(now.getTime() + 10);
        const finals = await failAllClaims(now);
        expect(finals).toHaveLength(1);
        expect(finals[0]!.attempt).toBe(2);
        const current = store.getLoop(loop.id)!;
        if (round < 4) {
          expect(current.status).toBe("active");
          expect(current.retryScheduledFor).toBeDefined();
        } else {
          expect(current.status).toBe("paused");
          expect(current.retryScheduledFor).toBeUndefined();
          const marker = store.listRuns({ loopId: loop.id, status: "skipped" })[0];
          expect(marker?.error).toContain("5 consecutive failed runs");
        }
      }
    } finally {
      store.close();
    }
  });

  test("a success resets the circuit breaker failure streak", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "breaker-reset",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          catchUp: "none",
          maxAttempts: 1,
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const runTick = async (status: ExecutorResult["status"]): Promise<void> => {
        // keep run rows on distinct created_at milliseconds for ordering
        await Bun.sleep(2);
        const due = store.getLoop(loop.id)!.nextRunAt!;
        await tick({
          store,
          runnerId: "test",
          now: () => new Date(due),
          random: noJitter,
          circuitBreakerThreshold: 3,
          execute: async () => result(status, due),
        });
      };

      await runTick("failed");
      await runTick("failed");
      await runTick("succeeded");
      expect(consecutiveFailureCount(store, loop.id)).toBe(0);
      await runTick("failed");
      await runTick("failed");
      expect(store.getLoop(loop.id)?.status).toBe("active");
      await runTick("failed");
      expect(store.getLoop(loop.id)?.status).toBe("paused");
    } finally {
      store.close();
    }
  });

  // Regression (HIGH 1): if a daemon finalizes a run terminal but dies/loses its
  // lease before advanceLoop, the terminal run stays in the due slot and every
  // future tick claims nothing — nextRunAt never moves, wedging the loop forever.
  // claimDueRuns/tick must idempotently advance past a terminal run left in the
  // due slot. Affects once/dynamic schedules and catchUp:"none".
  test("claimDueRuns repairs a once loop wedged by a terminal run left in the due slot", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "wedge-once",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const slot = loop.nextRunAt!;
      // Simulate the daemon: claim + finalize succeeded, but never advanceLoop.
      const claim = store.claimRun(loop, slot, "host:1:lease", new Date(slot));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        { status: "succeeded", finishedAt: "2026-01-01T00:00:01.000Z", durationMs: 1_000, stdout: "ok", stderr: "" },
        { claimedBy: "host:1:lease", now: new Date("2026-01-01T00:00:01Z") },
      );
      // Wedged: loop still active with nextRunAt pinned to the terminal slot, and
      // a fresh claim on that slot yields nothing.
      expect(store.getLoop(loop.id)?.status).toBe("active");
      expect(store.getLoop(loop.id)?.nextRunAt).toBe(slot);
      expect(
        store.claimRun(store.getLoop(loop.id)!, slot, "host:1:lease", new Date("2026-01-01T00:00:05Z")),
      ).toBeUndefined();

      const out = claimDueRuns({ store, runnerId: "host:1:lease", now: () => new Date("2026-01-01T00:00:05Z") });

      expect(out.claims).toHaveLength(0);
      const repaired = store.getLoop(loop.id);
      expect(repaired?.status).toBe("stopped");
      expect(repaired?.nextRunAt).toBeUndefined();
    } finally {
      store.close();
    }
  });

  test("tick repairs a catchUp:none interval loop wedged by a terminal run in the due slot", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "wedge-interval",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          catchUp: "none",
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const slot = loop.nextRunAt!;
      const claim = store.claimRun(loop, slot, "host:1:lease", new Date(slot));
      expect(claim).toBeDefined();
      const finishedAt = new Date(new Date(slot).getTime() + 1_000).toISOString();
      store.finalizeRun(
        claim!.run.id,
        { status: "succeeded", finishedAt, durationMs: 1_000, stdout: "ok", stderr: "" },
        { claimedBy: "host:1:lease", now: new Date(finishedAt) },
      );
      expect(store.getLoop(loop.id)?.nextRunAt).toBe(slot);

      const now = new Date(new Date(slot).getTime() + 5_000);
      const out = await tick({ store, runnerId: "host:1:lease", now: () => now });

      expect(out.claimed).toHaveLength(0);
      const repaired = store.getLoop(loop.id);
      expect(repaired?.status).toBe("active");
      expect(new Date(repaired!.nextRunAt!).getTime()).toBe(new Date(slot).getTime() + 60_000);
    } finally {
      store.close();
    }
  });
});

describe("claimDueRuns concurrency lanes", () => {
  const DUE = "2020-01-01T00:00:00Z";

  function laneStore(): { store: Store; workflowId: string } {
    const store = new Store(":memory:");
    const workflow = store.createWorkflow({
      name: "lane-wf",
      steps: [{ id: "s", target: { type: "command", command: "true" } }],
    });
    return { store, workflowId: workflow.id };
  }

  function makeCommandLoop(store: Store, name: string): Loop {
    return store.createLoop({
      name,
      schedule: { type: "once", at: DUE },
      target: { type: "command", command: "true" },
    });
  }

  function makeAgentLoop(store: Store, name: string, workflowId: string): Loop {
    return store.createLoop({
      name,
      schedule: { type: "once", at: DUE },
      target: { type: "workflow", workflowId },
    });
  }

  test("classifies command targets to the command lane and agent/workflow targets to the agent lane", () => {
    const { store, workflowId } = laneStore();
    try {
      expect(loopLane(makeCommandLoop(store, "cmd"))).toBe("command");
      expect(loopLane(makeAgentLoop(store, "wf", workflowId))).toBe("agent");
      expect(
        loopLane(
          store.createLoop({
            name: "agent-target",
            schedule: { type: "once", at: DUE },
            target: { type: "agent", provider: "claude", prompt: "hi" },
          }),
        ),
      ).toBe("agent");
    } finally {
      store.close();
    }
  });

  test("a saturated agent lane does not starve command-lane claims", () => {
    const { store, workflowId } = laneStore();
    try {
      // Two long agent/workflow loops + three fast command loops, all due.
      makeAgentLoop(store, "agent-0", workflowId);
      makeAgentLoop(store, "agent-1", workflowId);
      makeCommandLoop(store, "cmd-0");
      makeCommandLoop(store, "cmd-1");
      makeCommandLoop(store, "cmd-2");

      // Agent lane fully saturated (budget 0); command lane has room for two.
      const result = claimDueRuns({
        store,
        runnerId: "host:1:lease",
        maxClaims: 100,
        laneLimits: { command: 2, agent: 0 },
      });

      const lanes = result.claims.map((claim) => loopLane(claim.loop));
      expect(lanes.filter((lane) => lane === "agent")).toHaveLength(0);
      // Regression: the single shared pool let agent loops consume every slot,
      // so command loops were starved. Now the command lane claims independently.
      expect(lanes.filter((lane) => lane === "command")).toHaveLength(2);
    } finally {
      store.close();
    }
  });

  test("a saturated command lane does not starve agent-lane claims", () => {
    const { store, workflowId } = laneStore();
    try {
      makeCommandLoop(store, "cmd-0");
      makeCommandLoop(store, "cmd-1");
      makeAgentLoop(store, "agent-0", workflowId);
      makeAgentLoop(store, "agent-1", workflowId);

      const result = claimDueRuns({
        store,
        runnerId: "host:1:lease",
        maxClaims: 100,
        laneLimits: { command: 0, agent: 2 },
      });

      const lanes = result.claims.map((claim) => loopLane(claim.loop));
      expect(lanes.filter((lane) => lane === "command")).toHaveLength(0);
      expect(lanes.filter((lane) => lane === "agent")).toHaveLength(2);
    } finally {
      store.close();
    }
  });

  test("absent laneLimits, claims are bounded only by the global maxClaims (legacy single pool)", () => {
    const { store, workflowId } = laneStore();
    try {
      makeAgentLoop(store, "agent-0", workflowId);
      makeCommandLoop(store, "cmd-0");
      makeCommandLoop(store, "cmd-1");

      const result = claimDueRuns({ store, runnerId: "host:1:lease", maxClaims: 2 });
      expect(result.claims).toHaveLength(2);
    } finally {
      store.close();
    }
  });
});
