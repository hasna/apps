import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Store } from "../lib/store.js";
import { daemonLogLine, rotateDaemonLog, runDaemon } from "./daemon.js";
import { RESTART_INTERRUPTED_RUN_PREFIX } from "../lib/health.js";
import { isAlive, processStartTimeMs } from "./control.js";
import { tick } from "../lib/scheduler.js";
import { expectMarkerNeverWritten, gatedWriteCommand, waitUntil } from "../test-helpers.js";
import type { ExecutorResult, LoopRun } from "../types.js";

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

      await waitUntil(() => started >= 2, { label: "two runs started" });
      expect(started).toBe(2);
      expect(maxActive).toBe(2);
      await waitUntil(() => store.listRuns({ status: "succeeded" }).length >= 2, { label: "two runs succeeded" });
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

  test("separated lanes keep fast command loops running while the agent lane is saturated", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-lanes-"));
    const store = new Store(":memory:");
    let stop = false;
    let releaseAgents: () => void = () => undefined;
    const agentGate = new Promise<void>((resolve) => {
      releaseAgents = resolve;
    });
    let commandCompletions = 0;
    let agentActive = 0;
    let maxAgentActive = 0;
    try {
      const workflow = store.createWorkflow({
        name: "lane-agent-wf",
        steps: [{ id: "s", target: { type: "command", command: "true" } }],
      });
      // Three long agent/workflow loops (more than the agent lane budget) that
      // block until released, so the agent lane stays fully saturated.
      for (const i of [0, 1, 2]) {
        store.createLoop({
          name: `agent-hog-${i}`,
          schedule: { type: "once", at: "2020-01-01T00:00:00Z" },
          target: { type: "workflow", workflowId: workflow.id },
          overlap: "skip",
        });
      }
      // A fast command loop that keeps coming due.
      store.createLoop({
        name: "fast-command",
        schedule: { type: "interval", everyMs: 20 },
        target: { type: "command", command: "true" },
        overlap: "skip",
        catchUp: "none",
      });

      const daemon = runDaemon({
        store,
        pidPath: join(root, "loops-daemon.pid"),
        intervalMs: 5,
        // concurrency=2 is the legacy shared-pool knob (now the agent lane); the
        // command lane gets its own reserved budget. Under the old single pool the
        // three blocking agent runs would fill both slots and starve the command
        // loop entirely (commandCompletions would stay 0).
        concurrency: 2,
        commandConcurrency: 2,
        sleep: async (ms) => Bun.sleep(ms),
        shouldStop: () => stop,
        log: () => undefined,
        execute: async (loop) => {
          if (loop.target.type === "command") {
            commandCompletions += 1;
            return executorResult("succeeded", new Date().toISOString());
          }
          agentActive += 1;
          maxAgentActive = Math.max(maxAgentActive, agentActive);
          await agentGate;
          agentActive -= 1;
          return executorResult("succeeded", new Date().toISOString());
        },
      });

      await waitUntil(() => commandCompletions >= 3 && agentActive >= 2, {
        label: "command loop keeps running while agent lane saturated",
      });
      expect(commandCompletions).toBeGreaterThanOrEqual(3);
      // Agent lane budget (2) caps concurrent agent runs even though three are due.
      expect(agentActive).toBe(2);
      expect(maxAgentActive).toBe(2);

      stop = true;
      releaseAgents();
      await daemon;
    } finally {
      stop = true;
      releaseAgents();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("classifies active loop runs interrupted by daemon stop separately from workload failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-stop-run-"));
    const marker = join(root, "late-write");
    const gate = join(root, "gate");
    const store = new Store(":memory:");
    const controller = new AbortController();
    try {
      store.createLoop({
        name: "daemon-stop-command-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: gatedWriteCommand(gate, marker), shell: true },
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
      const running = await waitUntil(() => {
        const run = store.listRuns({ limit: 1 })[0];
        return run?.status === "running" ? run : undefined;
      }, { label: "command loop running" });
      expect(running).toBeDefined();

      controller.abort();
      await daemon;

      const run = store.getRun(running.id);
      await expectMarkerNeverWritten(gate, marker);
      expect(run?.status).toBe("skipped");
      expect(run?.error).toStartWith(RESTART_INTERRUPTED_RUN_PREFIX);
      expect(store.countRuns("failed")).toBe(0);
      expect(existsSync(marker)).toBe(false);
    } finally {
      if (!controller.signal.aborted) controller.abort();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("aborts active workflow children on daemon stop", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-stop-"));
    const marker = join(root, "late-write");
    const gate = join(root, "gate");
    const store = new Store(":memory:");
    const controller = new AbortController();
    try {
      const workflow = store.createWorkflow({
        name: "daemon-stop-workflow",
        steps: [
          {
            id: "slow",
            target: { type: "command", command: gatedWriteCommand(gate, marker), shell: true },
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
      const runId = await waitUntil(() => {
        const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
        return run && store.getWorkflowStepRun(run.id, "slow")?.status === "running" ? run.id : undefined;
      }, { label: "workflow step running" });
      expect(runId).toBeDefined();
      controller.abort();
      await daemon;
      await expectMarkerNeverWritten(gate, marker);
      const loopRun = store.listRuns({ limit: 1 })[0];
      expect(loopRun?.status).toBe("skipped");
      expect(loopRun?.error).toStartWith(RESTART_INTERRUPTED_RUN_PREFIX);
      expect(store.requireWorkflowRun(runId!).status).toBe("failed");
      expect(existsSync(marker)).toBe(false);
    } finally {
      if (!controller.signal.aborted) controller.abort();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("aborts active child work when another daemon takes the lease", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-lease-"));
    const marker = join(root, "late-write");
    const gate = join(root, "gate");
    const store = new Store(":memory:");
    try {
      store.createLoop({
        name: "daemon-lease-loss",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: gatedWriteCommand(gate, marker), shell: true },
        leaseMs: 100,
      });

      const daemon = runDaemon({
        store,
        pidPath: join(root, "loops-daemon.pid"),
        intervalMs: 5,
        sleep: async (ms) => Bun.sleep(ms),
        log: () => undefined,
      });

      const leaseDeleted = await waitUntil(() => {
        const running = store.listRuns({ limit: 1 })[0];
        const lease = store.getDaemonLease();
        if (running?.status !== "running" || !lease) return false;
        store.releaseDaemonLease(lease.id);
        store.acquireDaemonLease({ id: "other-daemon", pid: 999_999, hostname: "elsewhere", ttlMs: 60_000 });
        return true;
      }, { label: "run started and lease stolen" });
      await daemon;

      const run = store.listRuns({ limit: 1 })[0];
      expect(leaseDeleted).toBe(true);
      expect(run?.status).toBe("running");
      await expectMarkerNeverWritten(gate, marker);
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

  test("re-acquires the daemon lease after transient loss and aborts in-flight work", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-reacquire-"));
    const marker = join(root, "late-write");
    const gate = join(root, "gate");
    const store = new Store(":memory:");
    let stop = false;
    try {
      store.createLoop({
        name: "daemon-lease-reacquire",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: gatedWriteCommand(gate, marker), shell: true },
      });

      const daemon = runDaemon({
        store,
        pidPath: join(root, "loops-daemon.pid"),
        intervalMs: 5,
        sleep: async (ms) => Bun.sleep(ms),
        shouldStop: () => stop,
        log: () => undefined,
      });

      const released = await waitUntil(() => {
        const running = store.listRuns({ limit: 1 })[0];
        const lease = store.getDaemonLease();
        if (running?.status !== "running" || !lease) return false;
        store.releaseDaemonLease(lease.id);
        return true;
      }, { label: "run started and lease released" });
      expect(released).toBe(true);

      const lease = await waitUntil(() => store.getDaemonLease(), { label: "lease re-acquired" });
      expect(lease).toBeDefined();
      expect(lease?.pid).toBe(process.pid);

      const run = await waitUntil(() => {
        const latest = store.listRuns({ limit: 1 })[0];
        return latest?.status !== "running" ? latest : undefined;
      }, { label: "run left running state" });
      expect(run?.status).toBe("failed");

      stop = true;
      await daemon;
      await expectMarkerNeverWritten(gate, marker);
      expect(existsSync(marker)).toBe(false);
    } finally {
      stop = true;
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reaps orphan process groups returned by lease recovery", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-reap-"));
    const store = new Store(":memory:");
    let stop = false;
    const orphan = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    orphan.unref();
    try {
      await once(orphan, "spawn");
      const orphanPid = orphan.pid!;
      const loop = store.createLoop({
        name: "orphan-loop",
        schedule: { type: "once", at: "2099-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      });
      const fakeRun: LoopRun = {
        id: "orphan-run",
        loopId: loop.id,
        loopName: loop.name,
        scheduledFor: new Date().toISOString(),
        attempt: 1,
        status: "abandoned",
        pid: orphanPid,
        pgid: orphanPid,
        processStartedAt: new Date(processStartTimeMs(orphanPid) ?? Date.now()).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const original = store.recoverExpiredRunLeases.bind(store);
      let injected = false;
      store.recoverExpiredRunLeases = (now?: Date, opts?: Parameters<Store["recoverExpiredRunLeases"]>[1]) => {
        const recovered = original(now, opts);
        if (!injected) {
          injected = true;
          recovered.push(fakeRun);
        }
        return recovered;
      };

      const daemon = runDaemon({
        store,
        pidPath: join(root, "loops-daemon.pid"),
        intervalMs: 5,
        reapGraceMs: 200,
        sleep: async (ms) => Bun.sleep(ms),
        shouldStop: () => stop,
        log: () => undefined,
      });

      const dead = await waitUntil(() => !isAlive(orphanPid), { label: "orphan process reaped" });
      expect(injected).toBe(true);
      expect(dead).toBe(true);

      stop = true;
      await daemon;
    } finally {
      stop = true;
      try {
        process.kill(-orphan.pid!, "SIGKILL");
      } catch {
        /* already dead */
      }
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("startup recovery does not reap deferred runs owned by live inline owners", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-inline-owner-"));
    const store = new Store(":memory:");
    let stop = false;
    // Every inline surface claims runs as `<surface>:<pid>` and must be
    // spared: CLI run-now, CLI tick, and the SDK's inline client.
    const owners = ["manual", "manual-tick", "sdk"] as const;
    const children = owners.map(() => spawn("sleep", ["30"], { detached: true, stdio: "ignore" }));
    for (const child of children) child.unref();
    try {
      await Promise.all(children.map((child) => once(child, "spawn")));
      const claims = owners.map((owner, index) => {
        const loop = store.createLoop(
          {
            name: `${owner}-owner-loop`,
            schedule: { type: "once", at: `2099-01-01T00:0${index}:00Z` },
            target: { type: "command", command: "true" },
            leaseMs: 10,
          },
          new Date(),
        );
        // Inline run in another process: live owner, live child, lease
        // briefly lapsed (e.g. suspend/resume) before the daemon started.
        const runnerId = `${owner}:${process.pid}`;
        const claim = store.claimRun(loop, new Date().toISOString(), runnerId);
        expect(claim).toBeDefined();
        store.markRunPid(claim!.run.id, children[index]!.pid!, runnerId);
        return claim!;
      });
      await Bun.sleep(30);

      const daemon = runDaemon({
        store,
        pidPath: join(root, "loops-daemon.pid"),
        intervalMs: 5,
        reapGraceMs: 100,
        sleep: async (ms) => Bun.sleep(ms),
        shouldStop: () => stop,
        log: () => undefined,
      });
      await Bun.sleep(400);
      for (const [index, claim] of claims.entries()) {
        expect(isAlive(children[index]!.pid!)).toBe(true);
        expect(store.getRun(claim.run.id)?.status).toBe("running");
      }

      stop = true;
      await daemon;
    } finally {
      stop = true;
      for (const child of children) {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          /* already dead */
        }
      }
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("timestamps daemon log lines and rotates the log at the size limit", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-daemon-log-"));
    const path = join(root, "daemon.log");
    try {
      expect(daemonLogLine("hello")).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[loops-daemon\] hello$/);

      writeFileSync(path, "old\n");
      expect(rotateDaemonLog(path, 1_024, 2)).toBe(false);

      writeFileSync(path, "a".repeat(2_048));
      expect(rotateDaemonLog(path, 1_024, 2)).toBe(true);
      expect(readFileSync(path, "utf8")).toBe("");
      expect(readFileSync(`${path}.1`, "utf8")).toBe("a".repeat(2_048));

      writeFileSync(path, "b".repeat(2_048));
      expect(rotateDaemonLog(path, 1_024, 2)).toBe(true);
      expect(readFileSync(`${path}.1`, "utf8")).toBe("b".repeat(2_048));
      expect(readFileSync(`${path}.2`, "utf8")).toBe("a".repeat(2_048));

      writeFileSync(path, "c".repeat(2_048));
      expect(rotateDaemonLog(path, 1_024, 2)).toBe(true);
      expect(readFileSync(`${path}.1`, "utf8")).toBe("c".repeat(2_048));
      expect(readFileSync(`${path}.2`, "utf8")).toBe("b".repeat(2_048));
      expect(existsSync(`${path}.3`)).toBe(false);
    } finally {
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

      const leaseDeleted = await waitUntil(() => {
        const running = store.listRuns({ limit: 1 })[0];
        const lease = store.getDaemonLease();
        if (running?.status !== "running" || !lease) return false;
        store.releaseDaemonLease(lease.id);
        store.acquireDaemonLease({ id: "other-daemon", pid: 999_999, hostname: "elsewhere", ttlMs: 60_000 });
        writeFileSync(gate, "go");
        return true;
      }, { label: "run started and lease stolen" });
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
      const workflowRunId = await waitUntil(() => {
        const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
        const step = run ? store.getWorkflowStepRun(run.id, "fast") : undefined;
        const lease = store.getDaemonLease();
        if (!run || step?.status !== "running" || !lease) return undefined;
        store.releaseDaemonLease(lease.id);
        store.acquireDaemonLease({ id: "other-daemon", pid: 999_999, hostname: "elsewhere", ttlMs: 60_000 });
        writeFileSync(gate, "go");
        leaseDeleted = true;
        return run.id;
      }, { label: "workflow step running and lease stolen" });
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
