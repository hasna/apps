import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AmbiguousNameError, LoopArchivedError, LoopNotFoundError } from "./errors.js";
import { Store } from "./store.js";

// Credential fixtures assembled at runtime so the literal token shapes never
// appear contiguously in source (avoids tripping source secret scanners such as
// GitHub push protection); the scrubber still sees the full string at runtime.
const j = (...parts: string[]): string => parts.join("");
const ANT_KEY = j("sk-", "ant-api03-abcDEF123456789_-suffix");
const AWS_KEY = j("AKIA", "IOSFODNN7EXAMPLE");
const GH_PAT = j("ghp", "_AbCdEf0123456789AbCdEf0123456789");
const SLACK_TOKEN = j("xoxb", "-1234567890-abcdefghijklmn");
const OPENAI_KEY = j("sk-", "proj-AbCd1234EfGh5678IjKl9012");

const DEAD_PID = 0x3fffffff;

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

  test("claims explicit fanout rows per machine without weakening single-run leases", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "fanout",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          placement: { mode: "fanout", selector: { ids: ["machine-a", "machine-b"] } },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const slot = "2026-01-01T00:00:00.000Z";
      const machineA = store.claimRun(loop, slot, "runner-a", new Date(slot), { fanoutKey: "machine-a", machineId: "machine-a" });
      const duplicateA = store.claimRun(loop, slot, "runner-a-2", new Date(slot), { fanoutKey: "machine-a", machineId: "machine-a" });
      const machineB = store.claimRun(loop, slot, "runner-b", new Date(slot), { fanoutKey: "machine-b", machineId: "machine-b" });
      const single = store.claimRun(loop, "2026-01-01T00:00:01.000Z", "single-a", new Date(slot));
      const duplicateSingle = store.claimRun(loop, "2026-01-01T00:00:01.000Z", "single-b", new Date(slot));

      expect(machineA?.run).toMatchObject({ status: "running", fanoutKey: "machine-a", machineId: "machine-a" });
      expect(duplicateA).toBeUndefined();
      expect(machineB?.run).toMatchObject({ status: "running", fanoutKey: "machine-b", machineId: "machine-b" });
      expect(single?.run).toMatchObject({ status: "running", fanoutKey: "single" });
      expect(duplicateSingle).toBeUndefined();
      expect(store.listRuns({ loopId: loop.id })).toHaveLength(3);
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
      expect(store.getWorkflow(workflow.id)?.status).toBe("archived");
      expect(store.listWorkflowRuns({ workflowId: workflow.id })).toHaveLength(1);
      expect(store.listWorkflowEvents(run.id).map((event) => event.eventType)).toContain("workflow_archived");
    } finally {
      store.close();
    }
  });

  test("does not archive route-shaped workflows without generated route template metadata", () => {
    const store = new Store(":memory:");
    try {
      const invocation = store.createWorkflowInvocation({
        sourceRef: { kind: "event", id: "evt-reusable-route", dedupeKey: "todos-task:reusable-route" },
        subjectRef: { kind: "task", id: "reusable-route", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:reusable-route",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-reusable-route",
        subjectRef: "reusable-route",
        projectKey: "/tmp/open-loops",
      });
      const workflow = store.createWorkflow({
        name: "reusable-route-shaped-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "reusable-route-shaped-loop",
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
      store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
      const run = store.createWorkflowRun({ workflow, loop, scheduledFor: "2026-01-01T00:00:00.000Z" });

      store.finalizeWorkflowRun(run.id, "succeeded");

      expect(store.getWorkflow(workflow.id)?.status).toBe("active");
      expect(store.listWorkflowEvents(run.id).map((event) => event.eventType)).not.toContain("workflow_archived");
    } finally {
      store.close();
    }
  });

  test("enforces workflow foreign keys for workflow runs", () => {
    const store = new Store(":memory:");
    try {
      expect(() =>
        store.createWorkflowRun({
          workflow: {
            id: "missing-workflow",
            name: "missing-workflow",
            version: 1,
            status: "active",
            steps: [{ id: "worker", target: { type: "command", command: "true" } }],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ).toThrow();
    } finally {
      store.close();
    }
  });

  test("archives generated task-lifecycle route workflows after terminal runs", () => {
    const store = new Store(":memory:");
    try {
      const invocation = store.createWorkflowInvocation({
        templateId: "task-lifecycle",
        sourceRef: { kind: "event", id: "evt-task-lifecycle-route", dedupeKey: "todos-task:task-lifecycle-route" },
        subjectRef: { kind: "task", id: "task-lifecycle-route", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:task-lifecycle-route",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-task-lifecycle-route",
        subjectRef: "task-lifecycle-route",
        projectKey: "/tmp/open-loops",
      });
      const workflow = store.createWorkflow({
        name: "task-lifecycle-route-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "task-lifecycle-route-loop",
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
      store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
      const run = store.createWorkflowRun({ workflow, loop, scheduledFor: "2026-01-01T00:00:00.000Z" });

      store.finalizeWorkflowRun(run.id, "succeeded");

      expect(store.getWorkflow(workflow.id)?.status).toBe("archived");
      expect(store.listWorkflowEvents(run.id).map((event) => event.eventType)).toContain("workflow_archived");
    } finally {
      store.close();
    }
  });

  test("does not archive reusable workflows after ordinary terminal runs", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "manual-reusable-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const run = store.createWorkflowRun({ workflow, scheduledFor: "2026-01-01T00:00:00.000Z" });

      store.finalizeWorkflowRun(run.id, "succeeded");

      expect(store.getWorkflow(workflow.id)?.status).toBe("active");
      expect(store.listWorkflowEvents(run.id).map((event) => event.eventType)).not.toContain("workflow_archived");
    } finally {
      store.close();
    }
  });

  test("rejects new workflow loops that define nested top-level goals", () => {
    const store = new Store(":memory:");
    try {
      const workflowWithGoal = store.createWorkflow({
        name: "workflow-with-goal",
        goal: { objective: "Complete the workflow" },
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });

      expect(() =>
        store.createLoop({
          name: "nested-goal-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "workflow", workflowId: workflowWithGoal.id },
          goal: { objective: "Complete the loop" },
        }),
      ).toThrow("remove one goal wrapper");

      const workflowWithoutGoal = store.createWorkflow({
        name: "workflow-without-goal",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "loop-goal-only",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflowWithoutGoal.id },
        goal: { objective: "Complete the loop" },
      });

      expect(() => store.retargetWorkflowLoop(loop.id, workflowWithGoal.id)).toThrow("both define top-level goals");
      expect(() =>
        store.createAndRetargetWorkflowLoop(loop.id, {
          name: "replacement-with-goal",
          goal: { objective: "Complete the replacement workflow" },
          steps: [{ id: "worker", target: { type: "command", command: "true" } }],
        }),
      ).toThrow("also defines a top-level goal");
    } finally {
      store.close();
    }
  });

  test("clears active admission work items when a workflow loop fails before a workflow run exists", () => {
    const store = new Store(":memory:");
    try {
      const invocation = store.createWorkflowInvocation({
        templateId: "todos-task-worker-verifier",
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
      expect(store.getWorkflow(workflow.id)?.status).toBe("archived");
    } finally {
      store.close();
    }
  });

  test("terminal admission work items require explicit requeue before replaying stale loop links", () => {
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
      const directReplay = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:terminal:task.created",
        invocationId: secondInvocation.id,
        sourceType: "task.created",
        sourceRef: "evt-terminal-b",
        subjectRef: "terminal",
        projectKey: "/tmp/open-loops",
      });

      expect(directReplay.id).toBe(workItem.id);
      expect(directReplay.status).toBe("failed");
      expect(directReplay.loopId).toBe(loop.id);
      expect(() => store.refreshWorkflowInvocationForWorkItem(directReplay.id, {
        sourceRef: { kind: "event", id: "evt-terminal-b", dedupeKey: "todos-task:terminal:task.created" },
        subjectRef: { kind: "task", id: "terminal", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      })).toThrow("not refreshable");

      const requeued = store.requeueWorkflowWorkItem(workItem.id, { reason: "fixed failing route" });
      expect(requeued.status).toBe("queued");
      expect(requeued.loopId).toBeUndefined();
      expect(requeued.lastReason).toBe("fixed failing route");

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
      store.refreshWorkflowInvocationForWorkItem(replayed.id, {
        sourceRef: { kind: "event", id: "evt-terminal-b", dedupeKey: "todos-task:terminal:task.created" },
        subjectRef: { kind: "task", id: "terminal", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const nextLoop = store.createLoop({
        name: "terminal-replay-loop-b",
        schedule: { type: "once", at: "2026-01-01T00:01:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
      });
      const readmitted = store.admitWorkflowWorkItem(replayed.id, {
        workflowId: workflow.id,
        loopId: nextLoop.id,
        reason: "admitted by terminal replay",
      });
      expect(readmitted.status).toBe("admitted");
      expect(readmitted.attempts).toBe(2);
      expect(readmitted.lastReason).toBe("fixed failing route; admitted by terminal replay");
    } finally {
      store.close();
    }
  });

  test("deduped workflow invocations refresh routing metadata only through replayable work items", () => {
    const store = new Store(":memory:");
    try {
      const first = store.createWorkflowInvocation({
        templateId: "todos-task-worker-verifier",
        sourceRef: { kind: "event", id: "evt-route-old", dedupeKey: "todos-task:reroute" },
        subjectRef: { kind: "task", id: "reroute", path: "/tmp/open-codewith" },
        intent: "route",
        scope: { projectPath: "/tmp/open-codewith", accountPolicy: "single" },
        outputPolicy: { report: "always", createTask: "on_failure" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:reroute",
        invocationId: first.id,
        sourceType: "task.created",
        sourceRef: "evt-route-old",
        subjectRef: "reroute",
        projectKey: "/tmp/open-codewith",
      });

      const second = store.createWorkflowInvocation({
        templateId: "task-lifecycle",
        sourceRef: { kind: "event", id: "evt-route-new", dedupeKey: "todos-task:reroute" },
        subjectRef: { kind: "task", id: "reroute", path: "/tmp/open-codewith", raw: { title: "Updated title" } },
        intent: "route",
        scope: { projectPath: "/tmp/open-codewith", accountPolicy: "pool", worktreePolicy: "required" },
        outputPolicy: { report: "always", createTask: "on_actionable" },
      });

      expect(second.id).toBe(first.id);
      expect(second.templateId).toBe("todos-task-worker-verifier");
      expect(second.sourceRef.id).toBe("evt-route-old");

      const refreshed = store.refreshWorkflowInvocationForWorkItem(workItem.id, {
        templateId: "task-lifecycle",
        sourceRef: { kind: "event", id: "evt-route-new", dedupeKey: "todos-task:reroute" },
        subjectRef: { kind: "task", id: "reroute", path: "/tmp/open-codewith", raw: { title: "Updated title" } },
        intent: "route",
        scope: { projectPath: "/tmp/open-codewith", accountPolicy: "pool", worktreePolicy: "required" },
        outputPolicy: { report: "always", createTask: "on_actionable" },
      });

      expect(refreshed.id).toBe(first.id);
      expect(refreshed.templateId).toBe("task-lifecycle");
      expect(refreshed.sourceRef.id).toBe("evt-route-new");
      expect(refreshed.subjectRef.raw).toEqual({ title: "Updated title" });
      expect(refreshed.scope).toMatchObject({ accountPolicy: "pool", worktreePolicy: "required" });
      expect(refreshed.outputPolicy?.createTask).toBe("on_actionable");
      expect(new Date(refreshed.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(first.updatedAt).getTime());
    } finally {
      store.close();
    }
  });

  test("workflow invocation refresh rejects active and terminal work item history", () => {
    const store = new Store(":memory:");
    try {
      const refreshInput = {
        templateId: "task-lifecycle",
        sourceRef: { kind: "event" as const, id: "evt-route-new", dedupeKey: "todos-task:stable" },
        subjectRef: { kind: "task" as const, id: "stable", path: "/tmp/open-codewith", raw: { title: "Updated title" } },
        intent: "route" as const,
        scope: { projectPath: "/tmp/open-codewith", accountPolicy: "pool" },
        outputPolicy: { report: "always" as const, createTask: "on_actionable" as const },
      };
      const invocation = store.createWorkflowInvocation({
        templateId: "todos-task-worker-verifier",
        sourceRef: { kind: "event", id: "evt-route-old", dedupeKey: "todos-task:stable" },
        subjectRef: { kind: "task", id: "stable", path: "/tmp/open-codewith" },
        intent: "route",
        scope: { projectPath: "/tmp/open-codewith", accountPolicy: "single" },
        outputPolicy: { report: "always", createTask: "on_failure" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:stable",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-route-old",
        subjectRef: "stable",
        projectKey: "/tmp/open-codewith",
      });
      const workflow = store.createWorkflow({
        name: "stable-history-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "stable-history-loop",
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
      store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });

      expect(() => store.refreshWorkflowInvocationForWorkItem(workItem.id, refreshInput)).toThrow("not refreshable");
      expect(store.getWorkflowInvocation(invocation.id)?.templateId).toBe("todos-task-worker-verifier");

      const run = store.createWorkflowRun({ workflow, loop, scheduledFor: "2026-01-01T00:00:00.000Z" });
      store.finalizeWorkflowRun(run.id, "succeeded");
      expect(() => store.refreshWorkflowInvocationForWorkItem(workItem.id, refreshInput)).toThrow("not refreshable");
      expect(store.getWorkflowInvocation(invocation.id)?.templateId).toBe("todos-task-worker-verifier");
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

  test("archives generated route workflows when expired lease recovery fails their workflow run", () => {
    const store = new Store(":memory:");
    try {
      const invocation = store.createWorkflowInvocation({
        templateId: "todos-task-worker-verifier",
        sourceRef: { kind: "event", id: "evt-lease-route", dedupeKey: "todos-task:lease-route" },
        subjectRef: { kind: "task", id: "lease-route", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:lease-route",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-lease-route",
        subjectRef: "lease-route",
        projectKey: "/tmp/open-loops",
      });
      const workflow = store.createWorkflow({
        name: "lease-route-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop(
        {
          name: "lease-route-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: {
            type: "workflow",
            workflowId: workflow.id,
            input: {
              workflowInvocationId: invocation.id,
              workflowWorkItemId: workItem.id,
            },
          },
          leaseMs: 10,
          maxAttempts: 1,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      const workflowRun = store.createWorkflowRun({ workflow, loop, loopRun: claim!.run });

      const recovered = store.recoverExpiredRunLeases(new Date("2026-01-01T00:00:01Z"));

      expect(recovered).toHaveLength(1);
      expect(store.getWorkflowRun(workflowRun.id)?.status).toBe("failed");
      expect(store.getWorkflowWorkItem(workItem.id)?.status).toBe("failed");
      expect(store.getWorkflow(workflow.id)?.status).toBe("archived");
      expect(store.listWorkflowEvents(workflowRun.id).map((event) => event.eventType)).toContain("workflow_archived");
    } finally {
      store.close();
    }
  });

  test("recovers expired run leases in bounded batches", () => {
    const store = new Store(":memory:");
    try {
      const loops = [0, 1, 2].map((index) =>
        store.createLoop(
          {
            name: `expired-batch-${index}`,
            schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
            target: { type: "command", command: "true" },
            leaseMs: 10,
          },
          new Date("2025-12-31T00:00:00Z"),
        ),
      );
      for (const loop of loops) {
        expect(store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"))).toBeDefined();
      }

      const recovered = store.recoverExpiredRunLeases(new Date("2026-01-01T00:00:01Z"), { limit: 2 });
      expect(recovered).toHaveLength(2);
      expect(store.listRuns({ status: "abandoned" })).toHaveLength(2);
      expect(store.listRuns({ status: "running" })).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("expired run recovery does not starve behind live expired rows", () => {
    const store = new Store(":memory:");
    try {
      const loops = [0, 1, 2].map((index) =>
        store.createLoop(
          {
            name: `expired-live-scan-${index}`,
            schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
            target: { type: "command", command: "true" },
            leaseMs: 10,
          },
          new Date("2025-12-31T00:00:00Z"),
        ),
      );
      const claims = loops.map((loop) =>
        store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"))!,
      );
      store.markRunPid(claims[0]!.run.id, process.pid, "runner");
      store.markRunPid(claims[1]!.run.id, process.pid, "runner");

      const recovered = store.recoverExpiredRunLeases(new Date("2026-01-01T00:00:01Z"), { limit: 1, scanLimit: 3 });
      expect(recovered).toHaveLength(1);
      expect(recovered[0]?.id).toBe(claims[2]!.run.id);
      expect(store.getRun(claims[0]!.run.id)?.leaseExpiresAt).toBe("2026-01-01T00:01:01.000Z");
      expect(store.getRun(claims[1]!.run.id)?.leaseExpiresAt).toBe("2026-01-01T00:01:01.000Z");
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

  test("fenced loop updates cannot mutate workflow work items after daemon lease loss", () => {
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
      const invocation = store.createWorkflowInvocation({
        sourceRef: { kind: "event", id: "evt-loop-fence", dedupeKey: "todos-task:loop-fence" },
        subjectRef: { kind: "task", id: "loop-fence", path: "/tmp/open-loops" },
        intent: "route",
        scope: { projectPath: "/tmp/open-loops" },
      });
      const workItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:loop-fence",
        invocationId: invocation.id,
        sourceType: "task.created",
        sourceRef: "evt-loop-fence",
        subjectRef: "loop-fence",
        projectKey: "/tmp/open-loops",
      });
      const workflow = store.createWorkflow({
        name: "loop-fence-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "loop-fence-run",
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
      store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });

      store.releaseDaemonLease("daemon");
      expect(() => store.updateLoop(loop.id, { status: "paused" }, { daemonLeaseId: "daemon" })).toThrow("daemon lease lost");
      expect(store.getLoop(loop.id)?.status).toBe("active");
      expect(store.getWorkflowWorkItem(workItem.id)?.status).toBe("admitted");
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

  test("throws coded errors for missing and ambiguous loops", () => {
    const store = new Store(":memory:");
    try {
      expect(() => store.requireLoop("missing-loop")).toThrow(LoopNotFoundError);
      expect(() => store.requireUniqueLoop("missing-loop")).toThrow(LoopNotFoundError);
      const input = {
        name: "same-name",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" } as const,
        target: { type: "command", command: "true" } as const,
      };
      const first = store.createLoop(input, new Date("2025-12-31T00:00:00Z"));
      store.createLoop(input, new Date("2025-12-31T00:00:01Z"));
      expect(() => store.requireUniqueLoop("same-name")).toThrow(AmbiguousNameError);
      try {
        store.requireUniqueLoop("same-name");
      } catch (error) {
        expect((error as AmbiguousNameError).code).toBe("AMBIGUOUS_NAME");
      }
      // An archived same-named loop must not count toward ambiguity: archiving
      // one of the two duplicates leaves a single active loop that resolves.
      store.archiveLoop(first.id);
      expect(store.requireUniqueLoop("same-name").id).not.toBe(first.id);
      // Even a single active loop plus an archived namesake resolves cleanly.
      const solo = store.createLoop(
        { ...input, name: "solo-name" },
        new Date("2025-12-31T00:00:02Z"),
      );
      const archivedNamesake = store.createLoop(
        { ...input, name: "solo-name" },
        new Date("2025-12-31T00:00:03Z"),
      );
      store.archiveLoop(archivedNamesake.id);
      expect(store.requireUniqueLoop("solo-name").id).toBe(solo.id);
      // A uniquely-named loop still resolves after it is archived (so the caller
      // can report "loop is archived" rather than "loop not found").
      const lone = store.createLoop({ ...input, name: "lone-name" }, new Date("2025-12-31T00:00:04Z"));
      store.archiveLoop(lone.id);
      expect(store.requireUniqueLoop("lone-name").id).toBe(lone.id);
      try {
        store.requireLoop("missing-loop");
      } catch (error) {
        expect((error as LoopNotFoundError).code).toBe("LOOP_NOT_FOUND");
      }
    } finally {
      store.close();
    }
  });

  test("rejects mutations of archived loops until they are unarchived", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "archive-guard",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      store.archiveLoop(loop.id);
      expect(() => store.updateLoop(loop.id, { status: "active" })).toThrow(LoopArchivedError);
      try {
        store.updateLoop(loop.id, { status: "active" });
      } catch (error) {
        expect((error as LoopArchivedError).code).toBe("LOOP_ARCHIVED");
      }
      store.unarchiveLoop(loop.id);
      expect(store.updateLoop(loop.id, { status: "paused" }).status).toBe("paused");
    } finally {
      store.close();
    }
  });

  test("stamps gated migrations once and records the schema user_version", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-migration-ledger-"));
    const dbFile = join(root, "loops.db");
    const store = new Store(dbFile);
    let ids: string[];
    try {
      ids = (store["db"].query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: string }>).map(
        (row) => row.id,
      );
      expect(ids).toEqual([
        "0001_initial_and_workflows",
        "0002_loop_machines",
        "0003_goals",
        "0004_loop_archive_metadata",
        "0005_workflow_invocations_and_admission",
        "0006_run_process_tracking",
        "0007_run_claim_tokens",
        "0008_machine_placement_fanout",
      ]);
      const version = store["db"].query("PRAGMA user_version").get() as { user_version: number };
      expect(version.user_version).toBeGreaterThanOrEqual(8);
    } finally {
      store.close();
    }
    const reopened = new Store(dbFile);
    try {
      const again = (reopened["db"].query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: string }>).map(
        (row) => row.id,
      );
      expect(again).toEqual(ids);
    } finally {
      reopened.close();
    }
  });

  test("refuses to open databases written by a newer schema version", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-newer-schema-"));
    const dbFile = join(root, "loops.db");
    new Store(dbFile).close();
    const raw = new Database(dbFile);
    try {
      raw.exec("PRAGMA user_version = 99");
    } finally {
      raw.close();
    }
    expect(() => new Store(dbFile)).toThrow(/newer than this binary supports/);
  });

  test("upgrades version 6 stores before creating claim-token and fanout indexes", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-v6-claim-token-"));
    const dbFile = join(root, "loops.db");
    const raw = new Database(dbFile);
    try {
      raw.exec(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE loop_runs (
          id TEXT PRIMARY KEY,
          loop_id TEXT NOT NULL,
          loop_name TEXT NOT NULL,
          scheduled_for TEXT NOT NULL,
          attempt INTEGER NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          claimed_by TEXT,
          lease_expires_at TEXT,
          pid INTEGER,
          exit_code INTEGER,
          duration_ms INTEGER,
          stdout TEXT,
          stderr TEXT,
          error TEXT,
          goal_run_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          pgid INTEGER,
          process_started_at TEXT,
          UNIQUE(loop_id, scheduled_for)
        );
        INSERT INTO schema_migrations (id, applied_at) VALUES
          ('0001_initial_and_workflows', '2026-01-01T00:00:00.000Z'),
          ('0002_loop_machines', '2026-01-01T00:00:00.000Z'),
          ('0003_goals', '2026-01-01T00:00:00.000Z'),
          ('0004_loop_archive_metadata', '2026-01-01T00:00:00.000Z'),
          ('0005_workflow_invocations_and_admission', '2026-01-01T00:00:00.000Z'),
          ('0006_run_process_tracking', '2026-01-01T00:00:00.000Z');
        PRAGMA user_version = 6;
      `);
    } finally {
      raw.close();
    }

    const store = new Store(dbFile);
    try {
      const columns = (store["db"].query("PRAGMA table_info(loop_runs)").all() as Array<{ name: string }>).map(
        (column) => column.name,
      );
      expect(columns).toContain("claim_token");
      const indexes = (store["db"].query("PRAGMA index_list(loop_runs)").all() as Array<{ name: string }>).map(
        (index) => index.name,
      );
      expect(indexes).toContain("idx_runs_claim_token");
      const version = store["db"].query("PRAGMA user_version").get() as { user_version: number };
      expect(version.user_version).toBe(8);
      const ids = (store["db"].query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: string }>).map(
        (row) => row.id,
      );
      expect(ids).toContain("0007_run_claim_tokens");
      expect(ids).toContain("0008_machine_placement_fanout");
      expect(store.listRuns()).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("reconciles the live fork with a second 0004_* row and orphan columns", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-fork-reconcile-"));
    const dbFile = join(root, "loops.db");
    new Store(dbFile).close();
    const raw = new Database(dbFile);
    try {
      raw.exec("ALTER TABLE loops ADD COLUMN metadata_json TEXT");
      raw.exec("ALTER TABLE loop_runs ADD COLUMN source TEXT");
      raw
        .query("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)")
        .run("0004_loop_metadata", new Date().toISOString());
    } finally {
      raw.close();
    }
    const store = new Store(dbFile);
    try {
      const ids = (store["db"].query("SELECT id FROM schema_migrations WHERE id LIKE '0004%' ORDER BY id").all() as Array<{
        id: string;
      }>).map((row) => row.id);
      expect(ids).toEqual(["0004_loop_archive_metadata", "0004_loop_metadata"]);
      // Orphan columns are tolerated and never dropped; the store stays usable.
      const columns = (store["db"].query("PRAGMA table_info(loops)").all() as Array<{ name: string }>).map(
        (column) => column.name,
      );
      expect(columns).toContain("metadata_json");
      const runColumns = (store["db"].query("PRAGMA table_info(loop_runs)").all() as Array<{ name: string }>).map(
        (column) => column.name,
      );
      expect(runColumns).toContain("source");
      const loop = store.createLoop(
        {
          name: "fork-survivor",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      expect(store.claimRun(loop, "2026-01-01T00:00:00.000Z", "test")?.run.status).toBe("running");
    } finally {
      store.close();
    }
  });

  test("scrubs credentials from loop run output on finalize", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "scrub-run",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "test");
      const final = store.finalizeRun(claim!.run.id, {
        status: "failed",
        finishedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 1_000,
        stdout: `api key ${ANT_KEY} used`,
        stderr: 'export MY_API_KEY="q7Rt2xVz9LpW4mKe8s"',
        error: `auth failed with ${GH_PAT}`,
      });
      expect(final.stdout).toBe("api key [SCRUBBED] used");
      expect(final.stderr).toBe('export MY_API_KEY="[SCRUBBED]"');
      expect(final.error).toBe("auth failed with [SCRUBBED]");
      expect(store.getRun(claim!.run.id)?.stdout).not.toContain("sk-ant-");
    } finally {
      store.close();
    }
  });

  test("scrubs credentials from workflow step output and goal evidence", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "scrub-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const run = store.createWorkflowRun({ workflow });
      store.startWorkflowStepRun(run.id, "worker");
      const step = store.finalizeWorkflowStepRun(run.id, "worker", {
        status: "failed",
        finishedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 1_000,
        stdout: `using ${AWS_KEY} for aws`,
        stderr: `slack ${SLACK_TOKEN} rejected`,
        error: `token ${OPENAI_KEY} expired`,
      });
      expect(step.stdout).toBe("using [SCRUBBED] for aws");
      expect(step.stderr).toBe("slack [SCRUBBED] rejected");
      expect(step.error).toBe("token [SCRUBBED] expired");

      const goal = store.createGoal({ objective: "scrub evidence" });
      store.recordGoalEvent({
        goalId: goal.goalId,
        phase: "execute",
        status: "active",
        evidence: { note: `found ${ANT_KEY} in logs` },
        rawResponse: { text: `use ${GH_PAT}` },
      });
      const event = store.listGoalRuns({ goalId: goal.goalId })[0]!;
      expect(JSON.stringify(event.evidence)).not.toContain("sk-ant-");
      expect(JSON.stringify(event.evidence)).toContain("[SCRUBBED]");
      expect(JSON.stringify(event.rawResponse)).not.toContain("ghp_");

      // Quoted secrets inside evidence strings must be scrubbed BEFORE
      // JSON.stringify escapes the quotes and hides them from the patterns.
      const quoted = store.createGoal({ objective: "scrub quoted evidence" });
      store.recordGoalEvent({
        goalId: quoted.goalId,
        phase: "execute",
        status: "active",
        evidence: { note: 'saw export DB_PASSWORD="x9Kd2mQz7Lp4Rv8t" in output' },
        rawResponse: { result: 'export DB_PASSWORD="x9Kd2mQz7Lp4Rv8t"' },
      });
      const quotedEvent = store.listGoalRuns({ goalId: quoted.goalId })[0]!;
      expect(JSON.stringify(quotedEvent.evidence)).not.toContain("x9Kd2mQz7Lp4Rv8t");
      expect((quotedEvent.evidence as { note: string }).note).toBe('saw export DB_PASSWORD="[SCRUBBED]" in output');
      expect(JSON.stringify(quotedEvent.rawResponse)).not.toContain("x9Kd2mQz7Lp4Rv8t");
    } finally {
      store.close();
    }
  });

  test("records process identity and reports abandoned vs deferred lease recovery", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "process-tracking",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const dead = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      const recordedDead = store.recordRunProcess(dead!.run.id, {
        pid: DEAD_PID,
        pgid: DEAD_PID,
        processStartedAt: "2026-01-01T00:00:00.000Z",
      });
      expect(recordedDead?.pid).toBe(DEAD_PID);
      expect(recordedDead?.pgid).toBe(DEAD_PID);
      expect(recordedDead?.processStartedAt).toBe("2026-01-01T00:00:00.000Z");

      const alive = store.claimRun(loop, "2026-01-01T00:01:00.000Z", "runner", new Date("2026-01-01T00:01:00Z"));
      store.recordRunProcess(alive!.run.id, { pid: process.pid, pgid: process.pid });

      const result = store.recoverExpiredRunLeasesDetailed(new Date("2026-01-01T00:02:00Z"));
      expect(result.abandoned.map((run) => run.id)).toEqual([dead!.run.id]);
      expect(result.abandoned[0]?.pgid).toBe(DEAD_PID);
      expect(result.deferred.map((run) => run.id)).toEqual([alive!.run.id]);
      expect(result.deferred[0]?.pgid).toBe(process.pid);
      expect(store.getRun(dead!.run.id)?.status).toBe("abandoned");
      expect(store.getRun(alive!.run.id)?.status).toBe("running");
      // recoverExpiredRunLeases keeps returning the abandoned entries only.
      expect(store.recoverExpiredRunLeases(new Date("2026-01-01T00:02:00Z"))).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("lease recovery abandons runs whose live pid fails the start-time fingerprint", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "recycled-pid",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      // The recorded pid is alive (it is this test process) but the recorded
      // start-time fingerprint is a day off: a recycled pid. Recovery must
      // abandon the run instead of deferring it forever.
      const recycled = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      store.recordRunProcess(recycled!.run.id, {
        pid: process.pid,
        pgid: process.pid,
        processStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString(),
      });
      const result = store.recoverExpiredRunLeasesDetailed(new Date("2026-01-01T00:02:00Z"));
      expect(result.abandoned.map((run) => run.id)).toEqual([recycled!.run.id]);
      expect(result.deferred).toEqual([]);
      expect(store.getRun(recycled!.run.id)?.status).toBe("abandoned");

      // Same guard on the claim path: an expired lease whose pid fingerprint
      // mismatches must not block a takeover of the slot.
      const stale = store.claimRun(loop, "2026-01-01T00:10:00.000Z", "runner-a", new Date("2026-01-01T00:10:00Z"));
      store.recordRunProcess(stale!.run.id, {
        pid: process.pid,
        pgid: process.pid,
        processStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString(),
      });
      const takeover = store.claimRun(loop, "2026-01-01T00:10:00.000Z", "runner-b", new Date("2026-01-01T00:11:00Z"));
      expect(takeover).toBeDefined();
      expect(takeover?.run.claimedBy).toBe("runner-b");

      // A matching fingerprint keeps blocking the takeover while deferring.
      const genuine = store.claimRun(loop, "2026-01-01T00:20:00.000Z", "runner-c", new Date("2026-01-01T00:20:00Z"));
      store.recordRunProcess(genuine!.run.id, { pid: process.pid, pgid: process.pid });
      expect(store.claimRun(loop, "2026-01-01T00:20:00.000Z", "runner-d", new Date("2026-01-01T00:21:00Z"))).toBeUndefined();
      const deferredResult = store.recoverExpiredRunLeasesDetailed(new Date("2026-01-01T00:22:00Z"));
      expect(deferredResult.deferred.map((run) => run.id)).toEqual([genuine!.run.id]);
    } finally {
      store.close();
    }
  });

  test("markRunPid records the pid start-time fingerprint", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "mark-pid-fingerprint",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      const marked = store.markRunPid(claim!.run.id, process.pid, "runner");
      expect(marked?.pid).toBe(process.pid);
      // The fingerprint is required so recovery and the daemon reaper can
      // verify pid identity later (fail-closed against pid recycling).
      expect(marked?.processStartedAt).toBeDefined();
    } finally {
      store.close();
    }
  });

  test("prunes terminal run history by age with a per-loop retention floor", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "prune-history",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        },
        new Date("2025-01-01T00:00:00Z"),
      );
      const slots = [
        "2025-01-01T00:00:00.000Z",
        "2025-01-02T00:00:00.000Z",
        "2025-01-03T00:00:00.000Z",
        "2025-06-01T00:00:00.000Z",
        "2025-06-02T00:00:00.000Z",
      ];
      for (const slot of slots) {
        const claim = store.claimRun(loop, slot, "runner", new Date(slot));
        store.finalizeRun(claim!.run.id, {
          status: "succeeded",
          finishedAt: slot,
          durationMs: 1_000,
          stdout: "",
          stderr: "",
        });
      }
      const now = new Date("2025-06-10T00:00:00Z");

      const dry = store.pruneHistory({ maxAgeDays: 30, dryRun: true, now });
      expect(dry.dryRun).toBe(true);
      expect(dry.loopRuns).toBe(3);
      expect(store.countRuns()).toBe(5);

      const floored = store.pruneHistory({ maxAgeDays: 30, keepPerLoop: 4, now });
      expect(floored.loopRuns).toBe(1);
      expect(store.countRuns()).toBe(4);

      const pruned = store.pruneHistory({ maxAgeDays: 30, now });
      expect(pruned.loopRuns).toBe(2);
      expect(store.countRuns()).toBe(2);

      const keepOnly = store.pruneHistory({ keepPerLoop: 1, now });
      expect(keepOnly.loopRuns).toBe(1);
      expect(store.countRuns()).toBe(1);
      expect(store.listRuns({ loopId: loop.id })[0]?.scheduledFor).toBe("2025-06-02T00:00:00.000Z");
    } finally {
      store.close();
    }
  });

  test("pruneHistory skips candidates reclaimed to running before the delete batch commits", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "prune-reclaim-race",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          maxAttempts: 3,
        },
        new Date("2025-01-01T00:00:00Z"),
      );
      const slot = "2025-01-01T00:00:00.000Z";
      const claim = store.claimRun(loop, slot, "runner", new Date(slot));
      store.finalizeRun(claim!.run.id, {
        status: "failed",
        finishedAt: slot,
        durationMs: 1_000,
        stdout: "",
        stderr: "",
        error: "boom",
      });

      // Simulate a daemon retry reclaiming the run in the window between
      // candidate selection and the batched delete transaction.
      const internals = store as unknown as { transact<T>(fn: () => T): T };
      const originalTransact = internals.transact.bind(store);
      let reclaimed = false;
      internals.transact = <T,>(fn: () => T): T => {
        if (!reclaimed) {
          reclaimed = true;
          expect(store.claimRun(loop, slot, "retry-runner", new Date("2025-06-10T00:00:00Z"))).toBeDefined();
        }
        return originalTransact(fn);
      };

      const summary = store.pruneHistory({ maxAgeDays: 0, now: new Date("2025-06-10T00:00:00Z") });
      expect(reclaimed).toBe(true);
      expect(summary.loopRuns).toBe(0);
      const survivor = store.getRun(claim!.run.id);
      expect(survivor?.status).toBe("running");
      expect(survivor?.attempt).toBe(2);
    } finally {
      store.close();
    }
  });

  test("writes manifests for plain loop workflow runs via tmp-then-rename", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-plain-manifest-"));
    const store = new Store(join(root, "loops.db"));
    try {
      const workflow = store.createWorkflow({
        name: "plain-manifest-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "plain-manifest-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
      });
      const run = store.createWorkflowRun({ workflow, loop, scheduledFor: "2026-01-01T00:00:00.000Z" });
      expect(run.manifestPath).toBeDefined();
      expect(existsSync(run.manifestPath!)).toBe(true);
      expect(existsSync(`${run.manifestPath!}.tmp`)).toBe(false);
      const manifest = JSON.parse(readFileSync(run.manifestPath!, "utf8"));
      expect(manifest.workflowRunId).toBe(run.id);
      expect(manifest.loopId).toBe(loop.id);
    } finally {
      store.close();
    }
  });

  test("appends workflow events with contiguous sequences outside transactions", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "event-sequence-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const run = store.createWorkflowRun({ workflow });
      const second = store.appendWorkflowEvent(run.id, "custom_one");
      const third = store.appendWorkflowEvent(run.id, "custom_two");
      expect(second.sequence).toBe(2);
      expect(third.sequence).toBe(3);
      expect(store.listWorkflowEvents(run.id).map((event) => event.sequence)).toEqual([1, 2, 3]);
    } finally {
      store.close();
    }
  });

  test("re-planning goal nodes keeps existing keys and adds new ones", () => {
    const store = new Store(":memory:");
    try {
      const goal = store.createGoal({ objective: "replan" });
      store.createGoalPlanNodes(goal.goalId, [
        { key: "plan", objective: "write a plan" },
        { key: "verify", objective: "verify", dependsOn: ["plan"] },
      ]);
      const replanned = store.createGoalPlanNodes(goal.goalId, [
        { key: "plan", objective: "changed objective is ignored" },
        { key: "ship", objective: "ship it", dependsOn: ["verify"] },
      ]);
      expect(replanned.map((node) => node.key).sort()).toEqual(["plan", "ship", "verify"]);
      expect(replanned.find((node) => node.key === "plan")?.objective).toBe("write a plan");
    } finally {
      store.close();
    }
  });

  // Regression (MEDIUM 6): sqlite loop_runs has no FK to loops (postgres declares
  // ON DELETE CASCADE), so deleteLoop must delete run history itself — otherwise
  // running rows orphan and keep inflating daemonStatus.runs.running forever.
  test("deleteLoop removes child run history so orphaned running rows do not linger", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "delete-with-runs",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      expect(store.countRuns("running")).toBe(1);
      expect(store.listRuns({ loopId: loop.id })).toHaveLength(1);

      expect(store.deleteLoop(loop.id)).toBe(true);

      expect(store.listRuns({ loopId: loop.id })).toHaveLength(0);
      expect(store.countRuns()).toBe(0);
      expect(store.countRuns("running")).toBe(0);
    } finally {
      store.close();
    }
  });

  // Regression (MEDIUM 7): a manual goal rerun after a terminal outcome must not
  // reuse the terminal goal (which throws in assertGoalTransition) — the context
  // lookup skips terminal manual goals so runGoal creates a fresh one.
  test("findGoalByContext skips terminal manual goals so a rerun starts fresh", () => {
    const store = new Store(":memory:");
    try {
      const goal = store.createGoal({ objective: "tidy inbox", sourceType: "manual", sourceId: "tidy inbox" });
      // A non-terminal manual goal is resumed in place.
      expect(store.findGoalByContext({ sourceType: "manual", sourceId: "tidy inbox" })?.goalId).toBe(goal.goalId);
      // Once terminal it is skipped, so the caller creates a new goal instead of
      // reusing one that cannot transition.
      store.updateGoalStatus(goal.goalId, "cancelled");
      expect(store.findGoalByContext({ sourceType: "manual", sourceId: "tidy inbox" })).toBeUndefined();
    } finally {
      store.close();
    }
  });

  // Regression (LOW 9): a claimedBy-less finalize is unfenced; it must still not
  // resurrect or clobber a run that is no longer running.
  test("finalizeRun without claimedBy cannot clobber a terminal run", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "no-clobber",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        { status: "succeeded", finishedAt: "2026-01-01T00:00:01.000Z", durationMs: 1_000, stdout: "real", stderr: "" },
        { claimedBy: "runner", now: new Date("2026-01-01T00:00:01Z") },
      );
      expect(store.getRun(claim!.run.id)?.status).toBe("succeeded");

      const after = store.finalizeRun(claim!.run.id, {
        status: "failed",
        finishedAt: "2026-01-01T00:00:02.000Z",
        durationMs: 2_000,
        stdout: "clobber",
        stderr: "",
      });

      expect(after.status).toBe("succeeded");
      expect(after.stdout).toBe("real");
    } finally {
      store.close();
    }
  });

  // Regression (LOW 10): a :memory: store still mkdtempSync's a scratch root for
  // manifests; close() must remove it so short-lived instances don't leak temp dirs.
  test("closing a :memory: store removes its scratch temp dir", () => {
    const store = new Store(":memory:");
    const workflow = store.createWorkflow({
      name: "mem-temp-cleanup",
      steps: [{ id: "only", target: { type: "command", command: "true" } }],
    });
    const run = store.createWorkflowRun({ workflow });
    const manifestPath = run.manifestPath!;
    expect(manifestPath).toContain("open-loops-store-");
    // Derive the mkdtemp root (…/open-loops-store-XXXXXX) from the manifest path.
    const marker = manifestPath.indexOf("open-loops-store-");
    const tempRoot = manifestPath.slice(0, manifestPath.indexOf("/", marker));
    expect(existsSync(tempRoot)).toBe(true);

    store.close();

    expect(existsSync(tempRoot)).toBe(false);
  });
});
