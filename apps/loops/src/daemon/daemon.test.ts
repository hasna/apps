import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Store } from "../lib/store.js";
import { runDaemon } from "./daemon.js";
import { tick } from "../lib/scheduler.js";
import type { ExecutorResult } from "../types.js";

function executorResult(status: ExecutorResult["status"], at: string): ExecutorResult {
  return {
    status,
    exitCode: status === "succeeded" ? 0 : 1,
    stdout: status,
    stderr: "",
    error: status === "succeeded" ? undefined : status,
    startedAt: at,
    finishedAt: at,
    durationMs: 0,
  };
}

describe("daemon", () => {
  test("executes workflow loop targets from the daemon tick path", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-"));
    const store = new Store(":memory:");
    let stopped = false;
    try {
      const workflow = store.createWorkflow({
        name: "daemon-workflow",
        steps: [{ id: "step", target: { type: "command", command: "printf daemon-workflow", shell: true } }],
      });
      store.createLoop({
        name: "daemon-workflow-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
      });

      await runDaemon({
        store,
        pidPath: join(root, "loops-daemon.pid"),
        intervalMs: 5,
        sleep: async (ms) => {
          const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
          if (run && run.status !== "running") stopped = true;
          await Bun.sleep(ms);
        },
        shouldStop: () => stopped,
        log: () => undefined,
      });

      const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
      expect(run?.status).toBe("succeeded");
      expect(store.listWorkflowStepRuns(run!.id)[0]?.stdout).toContain("daemon-workflow");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("starts multiple due loop runs without waiting for the first to finish", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-concurrent-"));
    const store = new Store(":memory:");
    let stop = false;
    let started = 0;
    let active = 0;
    let maxActive = 0;
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    try {
      store.createLoop({
        name: "concurrent-a",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      });
      store.createLoop({
        name: "concurrent-b",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      });

      const daemon = runDaemon({
        store,
        pidPath: join(root, "loops-daemon.pid"),
        intervalMs: 5,
        concurrency: 2,
        sleep: async (ms) => Bun.sleep(ms),
        shouldStop: () => stop,
        log: () => undefined,
        execute: async () => {
          started += 1;
          active += 1;
          maxActive = Math.max(maxActive, active);
          if (started === 2) releaseGate();
          await gate;
          active -= 1;
          return executorResult("succeeded", "2026-01-01T00:00:00.000Z");
        },
      });

      for (let i = 0; i < 100 && started < 2; i++) await Bun.sleep(10);
      expect(started).toBe(2);
      expect(maxActive).toBe(2);
      for (let i = 0; i < 100 && store.listRuns({ status: "succeeded" }).length < 2; i++) await Bun.sleep(10);
      stop = true;
      await daemon;

      expect(store.listRuns({ status: "succeeded" })).toHaveLength(2);
      expect(store.findLoopByName("concurrent-a")?.status).toBe("stopped");
      expect(store.findLoopByName("concurrent-b")?.status).toBe("stopped");
    } finally {
      stop = true;
      releaseGate();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports due-slot backpressure when all daemon run slots are occupied", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-backpressure-"));
    const store = new Store(":memory:");
    const logs: string[] = [];
    let stop = false;
    let started = 0;
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    try {
      store.createLoop({
        name: "long-agent-shaped-command",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      });
      store.createLoop({
        name: "heartbeat-command",
        schedule: { type: "once", at: "2026-01-01T00:00:01Z" },
        target: { type: "command", command: "true" },
      });

      const daemon = runDaemon({
        store,
        pidPath: join(root, "loops-daemon.pid"),
        intervalMs: 5,
        concurrency: 1,
        sleep: async (ms) => Bun.sleep(ms),
        shouldStop: () => stop,
        log: (message) => logs.push(message),
        execute: async () => {
          started += 1;
          await gate;
          return executorResult("succeeded", "2026-01-01T00:00:02.000Z");
        },
      });

      for (let i = 0; i < 100 && !logs.some((line) => /backpressured=[1-9]/.test(line)); i++) {
        await Bun.sleep(10);
      }

      stop = true;
      releaseGate();
      await daemon;

      expect(started).toBe(1);
      expect(logs.some((line) => /backpressured=[1-9]/.test(line))).toBe(true);
    } finally {
      stop = true;
      releaseGate();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("aborts active workflow children on daemon stop", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-stop-"));
    const marker = join(root, "late-write");
    const store = new Store(":memory:");
    const controller = new AbortController();
    try {
      const workflow = store.createWorkflow({
        name: "daemon-stop-workflow",
        steps: [
          {
            id: "slow",
            target: { type: "command", command: `sleep 1; printf late > ${JSON.stringify(marker)}`, shell: true },
          },
        ],
      });
      store.createLoop({
        name: "daemon-stop-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
      });

      const daemon = runDaemon({
        store,
        pidPath: join(root, "loops-daemon.pid"),
        intervalMs: 5,
        signal: controller.signal,
        sleep: async (ms) => Bun.sleep(ms),
        shouldStop: () => controller.signal.aborted,
        log: () => undefined,
      });
      let runId: string | undefined;
      for (let i = 0; i < 100; i++) {
        const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
        if (run && store.getWorkflowStepRun(run.id, "slow")?.status === "running") {
          runId = run.id;
          break;
        }
        await Bun.sleep(10);
      }
      expect(runId).toBeDefined();
      controller.abort();
      await daemon;
      await Bun.sleep(1_100);
      expect(store.requireWorkflowRun(runId!).status).toBe("failed");
      expect(existsSync(marker)).toBe(false);
    } finally {
      if (!controller.signal.aborted) controller.abort();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("aborts active child work when the daemon lease is lost", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-lease-"));
    const marker = join(root, "late-write");
    const store = new Store(":memory:");
    try {
      store.createLoop({
        name: "daemon-lease-loss",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: `sleep 1; printf late > ${JSON.stringify(marker)}`, shell: true },
        leaseMs: 100,
      });

      const daemon = runDaemon({
        store,
        pidPath: join(root, "loops-daemon.pid"),
        intervalMs: 5,
        sleep: async (ms) => Bun.sleep(ms),
        log: () => undefined,
      });

      let leaseDeleted = false;
      for (let i = 0; i < 100; i++) {
        const run = store.listRuns({ limit: 1 })[0];
        const lease = store.getDaemonLease();
        if (run?.status === "running" && lease) {
          store.releaseDaemonLease(lease.id);
          leaseDeleted = true;
          break;
        }
        await Bun.sleep(10);
      }
      await daemon;

      const run = store.listRuns({ limit: 1 })[0];
      expect(leaseDeleted).toBe(true);
      expect(run?.status).toBe("running");
      await Bun.sleep(1_100);
      expect(existsSync(marker)).toBe(false);

      const recovered = await tick({
        store,
        runnerId: "recovery",
        now: () => new Date(Date.now() + 1_000),
        execute: async () => {
          throw new Error("should not execute after recovery");
        },
      });
      expect(recovered.recovered).toHaveLength(1);
      expect(store.getRun(run!.id)?.status).toBe("abandoned");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a completed child result when the daemon lease was lost before finalization", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-lease-race-"));
    const marker = join(root, "fast-write");
    const gate = join(root, "gate");
    const store = new Store(":memory:");
    const controller = new AbortController();
    try {
      store.createLoop({
        name: "daemon-lease-race",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: {
          type: "command",
          command: `while [ ! -f ${JSON.stringify(gate)} ]; do sleep 0.01; done; printf fast > ${JSON.stringify(marker)}`,
          shell: true,
        },
        leaseMs: 100,
      });

      const daemon = runDaemon({
        store,
        pidPath: join(root, "loops-daemon.pid"),
        intervalMs: 1_000,
        signal: controller.signal,
        sleep: async (ms) => Bun.sleep(ms),
        log: () => undefined,
      });

      let leaseDeleted = false;
      for (let i = 0; i < 100; i++) {
        const run = store.listRuns({ limit: 1 })[0];
        const lease = store.getDaemonLease();
        if (run?.status === "running" && lease) {
          store.releaseDaemonLease(lease.id);
          writeFileSync(gate, "go");
          leaseDeleted = true;
          break;
        }
        await Bun.sleep(10);
      }
      await daemon;

      const run = store.listRuns({ limit: 1 })[0];
      expect(leaseDeleted).toBe(true);
      expect(existsSync(marker)).toBe(true);
      expect(run?.status).toBe("running");
      expect(run?.stdout).toBeUndefined();

      const recovered = await tick({
        store,
        runnerId: "recovery",
        now: () => new Date(Date.now() + 1_000),
        execute: async () => {
          throw new Error("should not execute after recovery");
        },
      });
      expect(recovered.recovered).toHaveLength(1);
      expect(store.getRun(run!.id)?.status).toBe("abandoned");
    } finally {
      if (!controller.signal.aborted) controller.abort();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not commit workflow step success after daemon lease loss", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-workflow-lease-race-"));
    const marker = join(root, "workflow-fast-write");
    const gate = join(root, "workflow-gate");
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "daemon-workflow-lease-race",
        steps: [
          {
            id: "fast",
            target: {
              type: "command",
              command: `while [ ! -f ${JSON.stringify(gate)} ]; do sleep 0.01; done; printf fast > ${JSON.stringify(marker)}`,
              shell: true,
            },
          },
        ],
      });
      const loop = store.createLoop({
        name: "daemon-workflow-lease-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
        maxAttempts: 2,
        retryDelayMs: 1_000,
        leaseMs: 100,
      });

      const daemon = runDaemon({
        store,
        pidPath: join(root, "loops-daemon.pid"),
        intervalMs: 1_000,
        sleep: async (ms) => Bun.sleep(ms),
        log: () => undefined,
      });

      let leaseDeleted = false;
      let workflowRunId: string | undefined;
      for (let i = 0; i < 100; i++) {
        const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
        const step = run ? store.getWorkflowStepRun(run.id, "fast") : undefined;
        const lease = store.getDaemonLease();
        if (run && step?.status === "running" && lease) {
          workflowRunId = run.id;
          store.releaseDaemonLease(lease.id);
          writeFileSync(gate, "go");
          leaseDeleted = true;
          break;
        }
        await Bun.sleep(10);
      }
      await daemon;

      expect(leaseDeleted).toBe(true);
      expect(existsSync(marker)).toBe(true);
      expect(workflowRunId).toBeDefined();
      expect(store.requireWorkflowRun(workflowRunId!).status).not.toBe("succeeded");
      expect(store.getWorkflowStepRun(workflowRunId!, "fast")?.status).not.toBe("succeeded");

      const recovered = await tick({
        store,
        runnerId: "recovery",
        now: () => new Date(Date.now() + 1_000),
        execute: async () => {
          throw new Error("retry should not be due in the same recovery tick");
        },
      });
      expect(recovered.recovered).toHaveLength(1);
      expect(store.requireWorkflowRun(workflowRunId!).status).toBe("failed");
      expect(store.getWorkflowStepRun(workflowRunId!, "fast")?.status).toBe("skipped");
      expect(store.getLoop(loop.id)?.retryScheduledFor).toBe(loop.nextRunAt);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
