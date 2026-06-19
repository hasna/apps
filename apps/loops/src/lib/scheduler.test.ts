import { describe, expect, test } from "bun:test";
import type { ExecutorResult } from "../types.js";
import { tick } from "./scheduler.js";
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
});
