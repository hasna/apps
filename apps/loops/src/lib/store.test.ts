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

  test("persists loop machine assignments", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "machine-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          machine: {
            id: "spark01",
            route: "tailscale",
            local: false,
            workspacePath: "/home/hasna/workspace",
            resolvedAt: "2026-01-01T00:00:00.000Z",
          },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      expect(store.getLoop(loop.id)?.machine).toEqual(loop.machine);
      expect(store.listLoops()[0]?.machine?.id).toBe("spark01");
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

  test("daemon heartbeat cannot revive an expired lease", () => {
    const store = new Store(":memory:");
    try {
      expect(
        store.acquireDaemonLease({
          id: "expired",
          pid: 1,
          hostname: "host",
          ttlMs: 10,
          now: new Date("2026-01-01T00:00:00Z"),
        })?.id,
      ).toBe("expired");
      expect(store.heartbeatDaemonLease("expired", 1_000, new Date("2026-01-01T00:00:01Z"))).toBeUndefined();
      expect(
        store.acquireDaemonLease({
          id: "new-owner",
          pid: 2,
          hostname: "host",
          ttlMs: 1_000,
          now: new Date("2026-01-01T00:00:01Z"),
        })?.id,
      ).toBe("new-owner");
    } finally {
      store.close();
    }
  });

  test("run heartbeat cannot revive an expired run lease", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "run-heartbeat",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      expect(store.heartbeatRunLease(claim!.run.id, "runner", 1_000, new Date("2026-01-01T00:00:01Z"))).toBeUndefined();
      const final = store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "late",
          stderr: "",
        },
        { claimedBy: "runner", now: new Date("2026-01-01T00:00:01Z") },
      );
      expect(final.status).toBe("running");
      expect(final.stdout).toBeUndefined();
    } finally {
      store.close();
    }
  });

  test("fenced run heartbeat cannot extend after daemon lease loss", () => {
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
          name: "daemon-heartbeat",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          leaseMs: 60_000,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(
        loop,
        "2026-01-01T00:00:00.000Z",
        "runner",
        new Date("2026-01-01T00:00:00Z"),
        { daemonLeaseId: "daemon" },
      );
      expect(claim).toBeDefined();

      store.releaseDaemonLease("daemon");
      expect(
        store.heartbeatRunLease(claim!.run.id, "runner", 60_000, new Date("2026-01-01T00:00:10Z"), {
          daemonLeaseId: "daemon",
        }),
      ).toBeUndefined();
      expect(store.getRun(claim!.run.id)?.leaseExpiresAt).toBe("2026-01-01T00:01:00.000Z");
    } finally {
      store.close();
    }
  });

  test("fenced run finalization cannot write after daemon lease loss", () => {
    const store = new Store(":memory:");
    try {
      expect(
        store.acquireDaemonLease({
          id: "daemon",
          pid: 1,
          hostname: "host",
          ttlMs: 60_000,
        })?.id,
      ).toBe("daemon");
      const loop = store.createLoop(
        {
          name: "daemon-fenced-run",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          leaseMs: 60_000,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();

      store.releaseDaemonLease("daemon");
      const final = store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "late",
          stderr: "",
        },
        { claimedBy: "runner", daemonLeaseId: "daemon", now: new Date("2026-01-01T00:00:01Z") },
      );
      expect(final.status).toBe("running");
      expect(final.stdout).toBeUndefined();
      expect(final.finishedAt).toBeUndefined();
    } finally {
      store.close();
    }
  });

  test("fenced workflow finalization cannot write after daemon lease loss", () => {
    const store = new Store(":memory:");
    try {
      expect(
        store.acquireDaemonLease({
          id: "daemon",
          pid: 1,
          hostname: "host",
          ttlMs: 60_000,
        })?.id,
      ).toBe("daemon");
      const workflow = store.createWorkflow({
        name: "daemon-fenced-workflow",
        steps: [
          {
            id: "step-one",
            target: { type: "command", command: "true" },
          },
        ],
      });
      const run = store.createWorkflowRun({ workflow, daemonLeaseId: "daemon" });
      const startedStep = store.startWorkflowStepRun(run.id, "step-one", {
        daemonLeaseId: "daemon",
      });
      expect(startedStep.status).toBe("running");

      store.releaseDaemonLease("daemon");
      const finalStep = store.finalizeWorkflowStepRun(
        run.id,
        "step-one",
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "late",
          stderr: "",
          exitCode: 0,
        },
        { daemonLeaseId: "daemon" },
      );
      const finalRun = store.finalizeWorkflowRun(
        run.id,
        "succeeded",
        {
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
        },
        { daemonLeaseId: "daemon" },
      );

      expect(finalStep.status).toBe("running");
      expect(finalStep.stdout).toBeUndefined();
      expect(finalStep.finishedAt).toBeUndefined();
      expect(finalRun.status).toBe("running");
      expect(finalRun.finishedAt).toBeUndefined();
      expect(store.listWorkflowEvents(run.id).map((event) => event.eventType)).not.toContain("step_succeeded");
      expect(store.listWorkflowEvents(run.id).map((event) => event.eventType)).not.toContain("succeeded");
    } finally {
      store.close();
    }
  });

  test("fenced finalization cannot overwrite an abandoned expired run", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "fenced",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.recoverExpiredRunLeases(new Date("2026-01-01T00:00:01Z"));
      const final = store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:02.000Z",
          durationMs: 2_000,
          stdout: "late",
          stderr: "",
        },
        { claimedBy: "runner", now: new Date("2026-01-01T00:00:02Z") },
      );
      expect(final.status).toBe("abandoned");
      expect(final.stdout).toBeUndefined();
    } finally {
      store.close();
    }
  });
});
