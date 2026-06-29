import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";

describe("Store", () => {
  test("hardens existing store directory and sqlite files to owner-only permissions", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-store-permissions-"));
    const dbFile = join(root, "loops.db");
    const legacy = new Database(dbFile);
    try {
      legacy.exec("CREATE TABLE legacy_probe (id TEXT PRIMARY KEY);");
    } finally {
      legacy.close();
    }
    chmodSync(root, 0o755);
    chmodSync(dbFile, 0o644);

    const store = new Store(dbFile);
    try {
      expect(statSync(root).mode & 0o777).toBe(0o700);
      expect(statSync(dbFile).mode & 0o777).toBe(0o600);
      for (const sqliteSidecar of [`${dbFile}-wal`, `${dbFile}-shm`]) {
        if (existsSync(sqliteSidecar)) expect(statSync(sqliteSidecar).mode & 0o777).toBe(0o600);
      }
    } finally {
      store.close();
    }
  });

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

  test("tracks workflow invocations, admission work items, manifests, and terminal status", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-workflow-invocation-"));
    const store = new Store(join(root, "loops.db"));
    try {
      const invocation = store.createWorkflowInvocation({
        templateId: "todos-task-worker-verifier",
        sourceRef: { kind: "event", id: "evt-1", dedupeKey: "todos-task:task-1:task.created" },
        subjectRef: { kind: "task", id: "task-1", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops", worktreePolicy: "required" },
        outputPolicy: { report: "always", createTask: "on_failure" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:task-1:task.created",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-1",
        subjectRef: "task-1",
        projectKey: "/tmp/open-loops",
      });
      expect(workItem.status).toBe("queued");
      expect(store.countActiveWorkflowWorkItems({ projectKey: "/tmp/open-loops" })).toEqual({ global: 0, project: 0 });

      const workflow = store.createWorkflow({
        name: "route-task-1",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "route-task-1-run",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: {
          type: "workflow",
          workflowId: workflow.id,
          input: {
            workflowInvocationId: invocation.id,
            workflowWorkItemId: workItem.id,
          },
        },
      });
      const admitted = store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
      expect(admitted.status).toBe("admitted");
      expect(store.countActiveWorkflowWorkItems({ projectKey: "/tmp/open-loops" })).toEqual({ global: 1, project: 1 });

      const run = store.createWorkflowRun({ workflow, loop, scheduledFor: "2026-01-01T00:00:00.000Z" });
      expect(run.invocationId).toBe(invocation.id);
      expect(run.workItemId).toBe(workItem.id);
      expect(run.manifestPath).toBeDefined();
      expect(run.manifestPath).toContain("/runs/open-loops/task-task-1-");
      expect(existsSync(run.manifestPath!)).toBe(true);
      const manifest = JSON.parse(readFileSync(run.manifestPath!, "utf8"));
      expect(manifest.workflowInvocation.id).toBe(invocation.id);
      expect(manifest.workflowWorkItem.id).toBe(workItem.id);
      expect(store.getWorkflowWorkItem(workItem.id)?.status).toBe("running");

      store.finalizeWorkflowRun(run.id, "succeeded");
      expect(store.getWorkflowWorkItem(workItem.id)?.status).toBe("succeeded");
      expect(store.countActiveWorkflowWorkItems({ projectKey: "/tmp/open-loops" })).toEqual({ global: 0, project: 0 });
    } finally {
      store.close();
    }
  });

  test("clears active admission work items when a workflow loop fails before a workflow run exists", () => {
    const store = new Store(":memory:");
    try {
      const invocation = store.createWorkflowInvocation({
        sourceRef: { kind: "event", id: "evt-preflight-fail", dedupeKey: "todos-task:preflight-fail:task.created" },
        subjectRef: { kind: "task", id: "preflight-fail", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:preflight-fail:task.created",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-preflight-fail",
        subjectRef: "preflight-fail",
        projectKey: "/tmp/open-loops",
      });
      const workflow = store.createWorkflow({
        name: "preflight-fail-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "preflight-fail-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: {
          type: "workflow",
          workflowId: workflow.id,
          input: {
            workflowInvocationId: invocation.id,
            workflowWorkItemId: workItem.id,
          },
        },
        maxAttempts: 1,
      });
      store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
      expect(store.countActiveWorkflowWorkItems({ projectKey: "/tmp/open-loops" }).project).toBe(1);

      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "failed",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "",
          stderr: "",
          error: "runtime preflight failed before workflow run creation",
        },
        { claimedBy: "runner", now: new Date("2026-01-01T00:00:00.500Z") },
      );

      expect(store.getWorkflowWorkItem(workItem.id)?.status).toBe("failed");
      expect(store.countActiveWorkflowWorkItems({ projectKey: "/tmp/open-loops" }).project).toBe(0);
    } finally {
      store.close();
    }
  });

  test("terminal admission work items can be explicitly replayed without preserving stale loop links", () => {
    const store = new Store(":memory:");
    try {
      const firstInvocation = store.createWorkflowInvocation({
        sourceRef: { kind: "event", id: "evt-terminal-a", dedupeKey: "todos-task:terminal:task.created" },
        subjectRef: { kind: "task", id: "terminal", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:terminal:task.created",
        invocationId: firstInvocation.id,
        sourceType: "task.created",
        sourceRef: "evt-terminal-a",
        subjectRef: "terminal",
        projectKey: "/tmp/open-loops",
      });
      const workflow = store.createWorkflow({
        name: "terminal-replay-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "terminal-replay-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
      });
      const admitted = store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
      store.finalizeRun(
        store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"))!.run.id,
        {
          status: "failed",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "",
          stderr: "",
          error: "first attempt failed",
        },
        { claimedBy: "runner", now: new Date("2026-01-01T00:00:00.500Z") },
      );
      expect(store.getWorkflowWorkItem(admitted.id)?.status).toBe("failed");

      const secondInvocation = store.createWorkflowInvocation({
        sourceRef: { kind: "event", id: "evt-terminal-b", dedupeKey: "todos-task:terminal:task.created" },
        subjectRef: { kind: "task", id: "terminal", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const replayed = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:terminal:task.created",
        invocationId: secondInvocation.id,
        sourceType: "task.created",
        sourceRef: "evt-terminal-b",
        subjectRef: "terminal",
        projectKey: "/tmp/open-loops",
      });

      expect(replayed.id).toBe(workItem.id);
      expect(replayed.status).toBe("queued");
      expect(replayed.loopId).toBeUndefined();
      expect(replayed.workflowId).toBeUndefined();
      expect(replayed.workflowRunId).toBeUndefined();
      const nextLoop = store.createLoop({
        name: "terminal-replay-loop-b",
        schedule: { type: "once", at: "2026-01-01T00:01:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
      });
      expect(store.admitWorkflowWorkItem(replayed.id, { workflowId: workflow.id, loopId: nextLoop.id }).status).toBe("admitted");
    } finally {
      store.close();
    }
  });

  test("archives loops without deleting run history and hides them from default lists", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "archive-me",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      const dueSlot = loop.nextRunAt!;
      const claim = store.claimRun(loop, dueSlot, "seed", new Date(dueSlot));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "seed",
          stderr: "",
        },
        { claimedBy: "seed", now: new Date("2026-01-01T00:00:01Z") },
      );

      const archived = store.archiveLoop(loop.id);
      expect(archived.status).toBe("paused");
      expect(archived.archivedAt).toBeDefined();
      expect(archived.archivedFromStatus).toBe("active");
      expect(archived.nextRunAt).toBe(dueSlot);
      expect(store.listLoops()).toHaveLength(0);
      expect(store.listLoops({ archived: true }).map((entry) => entry.id)).toEqual([loop.id]);
      expect(store.listLoops({ includeArchived: true }).map((entry) => entry.id)).toEqual([loop.id]);
      expect(store.countLoops()).toBe(0);
      expect(store.countLoops(undefined, { archived: true })).toBe(1);
      expect(store.listRuns({ loopId: loop.id })).toHaveLength(1);
      expect(store.claimRun(archived, "2026-01-01T00:02:00.000Z", "manual", new Date("2026-01-01T00:02:00Z"))).toBeUndefined();

      const unarchived = store.unarchiveLoop(loop.id);
      expect(unarchived.status).toBe("active");
      expect(unarchived.archivedAt).toBeUndefined();
      expect(unarchived.archivedFromStatus).toBeUndefined();
      expect(store.listLoops().map((entry) => entry.id)).toEqual([loop.id]);
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

  test("persists goal state and fences goal mutators with the daemon lease", () => {
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

      const goal = store.createGoal(
        {
          objective: "ship goal support",
          tokenBudget: 100,
          autoExecute: "readyOnly",
          maxTokens: 100,
        },
        { daemonLeaseId: "daemon" },
      );
      store.createGoalPlanNodes(
        goal.goalId,
        [
          { key: "plan", objective: "write a plan" },
          { key: "verify", objective: "verify the plan", dependsOn: ["plan"], priority: 10 },
        ],
        { daemonLeaseId: "daemon" },
      );
      store.recordGoalEvent(
        {
          goalId: goal.goalId,
          phase: "plan",
          status: "active",
          tokensUsed: 10,
          evidence: { planned: true },
        },
        { daemonLeaseId: "daemon" },
      );

      expect(store.getGoal(goal.goalId)?.objective).toBe("ship goal support");
      expect(store.listGoalPlanNodes(goal.goalId).map((node) => node.key)).toEqual(["plan", "verify"]);
      expect(store.listGoalRuns({ goalId: goal.goalId })[0]?.phase).toBe("plan");

      store.releaseDaemonLease("daemon");
      expect(() =>
        store.recordGoalEvent(
          {
            goalId: goal.goalId,
            phase: "validate",
            status: "complete",
          },
          { daemonLeaseId: "daemon" },
        ),
      ).toThrow("daemon lease lost");
    } finally {
      store.close();
    }
  });

  test("migrate is idempotent — re-running issues no ALTER TABLE ADD COLUMN once columns exist", () => {
    const store = new Store(":memory:");
    try {
      // The constructor already ran migrate() once, so every additive column
      // now exists. Re-running migrate() must NOT issue an `ALTER TABLE ... ADD
      // COLUMN` for an existing column — doing so makes SQLite log a
      // "duplicate column name" error (libsqlite3 logs it before JS can catch
      // it), which is the noise this regression guards against.
      const internal = store as unknown as {
        db: { query: (sql: string) => { run: (...a: unknown[]) => unknown; all: () => unknown } };
        migrate: () => void;
      };
      const issued: string[] = [];
      const originalQuery = internal.db.query.bind(internal.db);
      internal.db.query = ((sql: string) => {
        issued.push(sql);
        return originalQuery(sql);
      }) as typeof internal.db.query;
      try {
        internal.migrate();
      } finally {
        internal.db.query = originalQuery as typeof internal.db.query;
      }
      const offending = issued.filter((sql) => /ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN/i.test(sql));
      expect(offending).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("migrates legacy workflow_runs before creating invocation indexes", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-legacy-workflow-runs-"));
    const dbFile = join(root, "loops.db");
    const legacy = new Database(dbFile);
    try {
      legacy.exec(`
        CREATE TABLE workflow_runs (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          workflow_name TEXT NOT NULL,
          loop_id TEXT,
          loop_run_id TEXT,
          scheduled_for TEXT,
          idempotency_key TEXT,
          status TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          duration_ms INTEGER,
          error TEXT,
          goal_run_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    } finally {
      legacy.close();
    }

    const store = new Store(dbFile);
    try {
      const columns = store["db"].query("PRAGMA table_info(workflow_runs)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain("invocation_id");
      expect(columns.map((column) => column.name)).toContain("work_item_id");
      expect(columns.map((column) => column.name)).toContain("manifest_path");
      const indexes = store["db"].query("PRAGMA index_list(workflow_runs)").all() as Array<{ name: string }>;
      expect(indexes.map((index) => index.name)).toContain("idx_workflow_runs_invocation");
      expect(indexes.map((index) => index.name)).toContain("idx_workflow_runs_work_item");
    } finally {
      store.close();
    }
  });
});
