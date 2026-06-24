import { describe, expect, test } from "bun:test";
import type { ExecutorResult } from "../types.js";
import { claimDueRuns, executeClaimedRun, manualRunScheduledFor, manualRunSource, shouldAdvanceManualRun, tick } from "./scheduler.js";
import { Store } from "./store.js";

function result(status: ExecutorResult["status"], at: string): ExecutorResult {
  return {
    status,
    exitCode: status === "succeeded" ? 0 : 1,
    stdout: "ok",
    stderr: "",
    error: status === "succeeded" ? undefined : "boom",
    startedAt: at,
    finishedAt: at,
    durationMs: 0,
  };
}

describe("scheduler", () => {
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

  test("claims only one due OpenRepos group loop by default", () => {
    const store = new Store(":memory:");
    try {
      for (const name of ["one", "two", "three"]) {
        store.createLoop(
          {
            name,
            schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
            target: { type: "command", command: "true" },
            metadata: {
              openReposSource: "open-repos",
              openReposGroup: "daily",
              openReposRepoName: name,
              openReposMaxConcurrency: 1,
            },
          },
          new Date("2025-12-31T00:00:00Z"),
        );
      }

      const out = claimDueRuns({
        store,
        runnerId: "daemon",
        now: () => new Date("2026-01-01T00:00:00Z"),
        maxClaims: 4,
      });

      expect(out.claims).toHaveLength(1);
      expect(out.claimed[0]?.status).toBe("running");
      expect(store.listRuns({ status: "running" })).toHaveLength(1);

      const second = claimDueRuns({
        store,
        runnerId: "daemon",
        now: () => new Date("2026-01-01T00:00:00Z"),
        maxClaims: 4,
      });
      expect(second.claims).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("honors explicit OpenRepos group max concurrency", () => {
    const store = new Store(":memory:");
    try {
      for (const name of ["one", "two", "three"]) {
        store.createLoop(
          {
            name,
            schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
            target: { type: "command", command: "true" },
            metadata: {
              openReposSource: "open-repos",
              openReposGroup: "daily",
              openReposRepoName: name,
              openReposMaxConcurrency: 2,
            },
          },
          new Date("2025-12-31T00:00:00Z"),
        );
      }

      const out = claimDueRuns({
        store,
        runnerId: "daemon",
        now: () => new Date("2026-01-01T00:00:00Z"),
        maxClaims: 4,
      });

      expect(out.claims).toHaveLength(2);
      expect(store.listRuns({ status: "running" })).toHaveLength(2);
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
        execute: async () => result("failed", "2026-01-01T00:00:00.000Z"),
      });
      const afterFail = store.getLoop(loop.id);
      expect(afterFail?.retryScheduledFor).toBe("2026-01-01T00:00:00.000Z");
      expect(afterFail?.nextRunAt).toBe("2026-01-01T00:00:01.000Z");
      await tick({
        store,
        runnerId: "test",
        now: () => new Date("2026-01-01T00:00:01Z"),
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
        execute: async () => result("succeeded", "2026-01-01T00:00:10.000Z"),
      });

      expect(store.getLoop(loop.id)?.retryScheduledFor).toBe(firstSlot);
      expect(store.getLoop(loop.id)?.nextRunAt).toBe("2026-01-01T00:00:15.000Z");

      await tick({
        store,
        runnerId: "retry-first",
        now: () => new Date("2026-01-01T00:00:15Z"),
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
});
