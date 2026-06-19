import { describe, expect, test } from "bun:test";
import { Store } from "./store.js";

describe("Store", () => {
  test("creates loops and claims one run per scheduled slot", () => {
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
      const first = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "test");
      const second = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "test");
      expect(first?.run.status).toBe("running");
      expect(second).toBeUndefined();
      expect(store.listRuns({ loopId: loop.id })).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("recovers expired run leases as abandoned", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "lease",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "test", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      const recovered = store.recoverExpiredRunLeases(new Date("2026-01-01T00:00:01Z"));
      expect(recovered).toHaveLength(1);
      expect(recovered[0]?.status).toBe("abandoned");
    } finally {
      store.close();
    }
  });

  test("only one connection can claim a scheduled slot", () => {
    const path = `${process.env.TMPDIR ?? "/tmp"}/loops-claim-${Date.now()}-${Math.random()}.db`;
    const first = new Store(path);
    const second = new Store(path);
    try {
      const loop = first.createLoop(
        {
          name: "race",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const slot = "2026-01-01T00:00:00.000Z";
      const claimA = first.claimRun(loop, slot, "a");
      const claimB = second.claimRun(loop, slot, "b");
      expect([claimA, claimB].filter(Boolean)).toHaveLength(1);
      expect(first.listRuns({ loopId: loop.id })).toHaveLength(1);
    } finally {
      first.close();
      second.close();
    }
  });

  test("daemon heartbeat returns undefined after lease takeover", () => {
    const store = new Store(":memory:");
    try {
      const first = store.acquireDaemonLease({
        id: "first",
        pid: 1,
        hostname: "host",
        ttlMs: 100,
        now: new Date("2026-01-01T00:00:00Z"),
      });
      expect(first?.id).toBe("first");
      const second = store.acquireDaemonLease({
        id: "second",
        pid: 2,
        hostname: "host",
        ttlMs: 1_000,
        now: new Date("2026-01-01T00:00:01Z"),
      });
      expect(second?.id).toBe("second");
      expect(store.heartbeatDaemonLease("first", 1_000, new Date("2026-01-01T00:00:02Z"))).toBeUndefined();
    } finally {
      store.close();
    }
  });
});
