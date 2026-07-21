import { describe, expect, test } from "bun:test";
import { LoopAdvancementConflictError } from "./errors.js";
import { advanceLoop } from "./scheduler.js";
import { Store } from "./store.js";

const noJitter = (): number => 0.5;

describe("loop advancement storage and scheduler integration", () => {
  test("reverse-order finalization preserves the earliest owed retry without cursor regression", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "reverse-order-retry",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          overlap: "allow",
          maxAttempts: 2,
          retryDelayMs: 1_000,
        },
        new Date("2026-01-01T00:00:00.000Z"),
      );
      const older = store.claimRun(
        loop,
        "2026-01-01T00:00:00.000Z",
        "runner",
        new Date("2026-01-01T00:00:01.000Z"),
      )!;
      const newer = store.claimRun(
        loop,
        "2026-01-01T00:01:00.000Z",
        "runner",
        new Date("2026-01-01T00:01:01.000Z"),
      )!;
      const newerSuccess = store.finalizeRun(newer.run.id, {
        status: "succeeded",
        finishedAt: "2026-01-01T00:01:10.000Z",
        stdout: "",
        stderr: "",
      });
      advanceLoop(store, loop, newerSuccess, new Date("2026-01-01T00:01:10.000Z"), true, { random: noJitter });
      expect(store.getLoop(loop.id)?.nextRunAt).toBe("2026-01-01T00:02:00.000Z");

      const olderFailure = store.finalizeRun(older.run.id, {
        status: "failed",
        finishedAt: "2026-01-01T00:01:11.000Z",
        stdout: "",
        stderr: "",
        error: "retry me",
      });
      advanceLoop(store, loop, olderFailure, new Date("2026-01-01T00:01:11.000Z"), false, { random: noJitter });
      expect(store.getLoop(loop.id)).toMatchObject({
        status: "active",
        nextRunAt: "2026-01-01T00:02:00.000Z",
        retryScheduledFor: older.run.scheduledFor,
      });
      expect(store.nextRetryableRun(loop.id, loop.maxAttempts)?.scheduledFor).toBe(older.run.scheduledFor);
    } finally {
      store.close();
    }
  });

  test("samples retry jitter once and reuses it across one CAS replan", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "retry-cas-replan-sample",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          overlap: "allow",
          maxAttempts: 2,
          retryDelayMs: 1_000,
        },
        new Date("2026-01-01T00:00:00.000Z"),
      );
      const claim = store.claimRun(
        loop,
        "2026-01-01T00:01:00.000Z",
        "runner",
        new Date("2026-01-01T00:01:01.000Z"),
      )!;
      const failed = store.finalizeRun(claim.run.id, {
        status: "failed",
        finishedAt: "2026-01-01T00:01:10.000Z",
        stdout: "",
        stderr: "",
        error: "retry me",
      });
      const originalAdvance = store.advanceLoopIfCurrent.bind(store);
      let loseFirst = true;
      store.advanceLoopIfCurrent = (...args) => {
        if (loseFirst) {
          loseFirst = false;
          return undefined;
        }
        return originalAdvance(...args);
      };
      let samples = 0;
      advanceLoop(store, loop, failed, new Date(failed.finishedAt!), false, {
        random: () => {
          samples += 1;
          return samples === 1 ? 0 : 0.999999;
        },
      });
      expect(samples).toBe(1);
      expect(store.getLoop(loop.id)).toMatchObject({
        nextRunAt: "2026-01-01T00:01:10.500Z",
        retryScheduledFor: claim.run.scheduledFor,
      });
    } finally {
      store.close();
    }
  });

  test("replans once after a distinct-slot recurrence wins the retry advancement CAS", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "retry-cas-replan",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          overlap: "allow",
          maxAttempts: 2,
          retryDelayMs: 1_000,
        },
        new Date("2026-01-01T00:00:00.000Z"),
      );
      const older = store.claimRun(
        loop,
        "2026-01-01T00:01:00.000Z",
        "older-runner",
        new Date("2026-01-01T00:01:01.000Z"),
      )!;
      const olderFailure = store.finalizeRun(older.run.id, {
        status: "failed",
        finishedAt: "2026-01-01T00:02:10.000Z",
        stdout: "",
        stderr: "",
        error: "retry me",
      });
      const originalAdvance = store.advanceLoopIfCurrent.bind(store);
      let injectRecurrence = true;
      store.advanceLoopIfCurrent = (...args) => {
        if (injectRecurrence) {
          injectRecurrence = false;
          const current = store.getLoop(loop.id)!;
          originalAdvance(loop.id, current, {
            status: "active",
            nextRunAt: "2026-01-01T00:03:00.000Z",
            retryScheduledFor: undefined,
          });
        }
        return originalAdvance(...args);
      };

      advanceLoop(store, loop, olderFailure, new Date(olderFailure.finishedAt!), false, { random: noJitter });

      expect(store.getLoop(loop.id)).toMatchObject({
        status: "active",
        nextRunAt: "2026-01-01T00:03:00.000Z",
        retryScheduledFor: older.run.scheduledFor,
      });
    } finally {
      store.close();
    }
  });

  test("replans once after a distinct-slot recurrence wins the breaker advancement CAS", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "breaker-cas-replan",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "false" },
          overlap: "allow",
          maxAttempts: 1,
        },
        new Date("2026-01-01T00:00:00.000Z"),
      );
      const breaker = store.claimRun(
        loop,
        "2026-01-01T00:02:00.000Z",
        "breaker-runner",
        new Date("2026-01-01T00:02:01.000Z"),
      )!;
      const breakerFailure = store.finalizeRun(breaker.run.id, {
        status: "failed",
        finishedAt: "2026-01-01T00:02:10.000Z",
        stdout: "",
        stderr: "",
        error: "final failure",
      });
      const originalBreaker = store.tripCircuitBreakerIfCurrent.bind(store);
      const originalAdvance = store.advanceLoopIfCurrent.bind(store);
      let injectRecurrence = true;
      store.tripCircuitBreakerIfCurrent = (...args) => {
        if (injectRecurrence) {
          injectRecurrence = false;
          const current = store.getLoop(loop.id)!;
          originalAdvance(loop.id, current, {
            status: "active",
            nextRunAt: breaker.run.scheduledFor,
            retryScheduledFor: undefined,
          });
        }
        return originalBreaker(...args);
      };

      advanceLoop(store, loop, breakerFailure, new Date(breakerFailure.finishedAt!), false, {
        random: noJitter,
        circuitBreakerThreshold: 1,
      });

      expect(store.getLoop(loop.id)).toMatchObject({
        status: "paused",
        nextRunAt: "2026-01-01T00:03:00.000Z",
        retryScheduledFor: undefined,
      });
      expect(store.listRuns({ loopId: loop.id, status: "skipped" })).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("surfaces a typed bounded conflict when both advancement CAS attempts lose", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "advancement-double-cas-loss",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        },
        new Date("2026-01-01T00:00:00.000Z"),
      );
      const claim = store.claimRun(
        loop,
        "2026-01-01T00:01:00.000Z",
        "runner",
        new Date("2026-01-01T00:01:01.000Z"),
      )!;
      const final = store.finalizeRun(claim.run.id, {
        status: "succeeded",
        finishedAt: "2026-01-01T00:01:10.000Z",
        stdout: "",
        stderr: "",
      });
      let attempts = 0;
      store.advanceLoopIfCurrent = () => {
        attempts += 1;
        return undefined;
      };

      expect(() => advanceLoop(store, loop, final, new Date(final.finishedAt!), true))
        .toThrow(LoopAdvancementConflictError);
      expect(attempts).toBe(2);
    } finally {
      store.close();
    }
  });

  test("circuit breaker transition leaves neither marker nor pause after CAS loss or rollback", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "atomic-breaker",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "false" },
        },
        new Date("2026-01-01T00:00:00.000Z"),
      );
      const patch = {
        status: "paused" as const,
        nextRunAt: "2026-01-01T00:01:00.000Z",
        retryScheduledFor: undefined,
      };
      const stale = {
        ...loop,
        nextRunAt: "2025-12-31T23:59:00.000Z",
      };
      expect(store.tripCircuitBreakerIfCurrent(
        loop.id,
        stale,
        patch,
        { scheduledFor: "2026-01-01T00:00:10.000Z", reason: "circuit breaker open: stale" },
      )).toBeUndefined();
      expect(store.getLoop(loop.id)?.status).toBe("active");
      expect(store.listRuns({ loopId: loop.id, status: "skipped" })).toHaveLength(0);

      const raw = store as unknown as { db: { exec(sql: string): void } };
      raw.db.exec(`
        CREATE TRIGGER fail_breaker_marker
        BEFORE INSERT ON loop_runs
        WHEN NEW.status = 'skipped'
        BEGIN
          SELECT RAISE(ABORT, 'injected marker failure');
        END
      `);
      expect(() => store.tripCircuitBreakerIfCurrent(
        loop.id,
        store.getLoop(loop.id)!,
        patch,
        { scheduledFor: "2026-01-01T00:00:10.000Z", reason: "circuit breaker open: rollback" },
      )).toThrow("injected marker failure");
      expect(store.getLoop(loop.id)?.status).toBe("active");
      expect(store.listRuns({ loopId: loop.id, status: "skipped" })).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("CAS mutation rejects an expired daemon lease without changing scheduling state", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "expired-daemon-fence",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        },
        new Date("2026-01-01T00:00:00.000Z"),
      );
      const lease = store.acquireDaemonLease({
        id: "lease-expired",
        pid: 1234,
        hostname: "host",
        ttlMs: 1_000,
        now: new Date("2026-01-01T00:00:00.000Z"),
      });
      expect(lease).toBeTruthy();
      const before = store.getLoop(loop.id)!;
      expect(store.advanceLoopIfCurrent(
        loop.id,
        before,
        { nextRunAt: "2026-01-01T00:02:00.000Z" },
        {
          daemonLeaseId: "lease-expired",
          now: new Date("2026-01-01T00:00:02.000Z"),
        },
      )).toBeUndefined();
      expect(store.getLoop(loop.id)).toEqual(before);
    } finally {
      store.close();
    }
  });
});
