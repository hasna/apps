import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyNonProductiveStepFailure,
  Store,
  WORK_ITEM_TEMPFAIL_EXIT_CODE,
} from "./store.js";

// Neutralization coverage for the 0.4.18 drain-reliability family. Each block is
// written fail-without/pass-with: revert the corresponding fix and the assertion
// flips. finalizeWorkflowRun persists a run manifest, so the store tests use a
// temp-dir file db with LOOPS_DATA_DIR pinned to it — nothing touches real state.

// (b)/(c) — classify the decisive failing step of a finalized failed run. Pure,
// so exercised directly without a store.
describe("classifyNonProductiveStepFailure", () => {
  test("a fast triage/planner gate failure is a gate death (does not count toward the cap)", () => {
    expect(classifyNonProductiveStepFailure([{ stepId: "triage", status: "failed", exitCode: 1, durationMs: 3_000 }])).toBe(
      "gate-death",
    );
    expect(classifyNonProductiveStepFailure([{ stepId: "planner", status: "failed", exitCode: 2, durationMs: 12_000 }])).toBe(
      "gate-death",
    );
  });

  test("a worktree-preparation failure is a gate death regardless of duration", () => {
    expect(
      classifyNonProductiveStepFailure([
        {
          stepId: "worker",
          status: "failed",
          exitCode: 1,
          durationMs: 240_000,
          error: "worktree preparation failed (mode=required): existing worktree /x belongs to a different git common dir",
        },
      ]),
    ).toBe("gate-death");
  });

  test("exit 75 is a tempfail (retry-later signal), not a real attempt", () => {
    expect(
      classifyNonProductiveStepFailure([{ stepId: "worker", status: "failed", exitCode: WORK_ITEM_TEMPFAIL_EXIT_CODE, durationMs: 5_000 }]),
    ).toBe("tempfail");
    // A tempfail wins even when it happens at a gate step.
    expect(classifyNonProductiveStepFailure([{ stepId: "triage", status: "failed", exitCode: 75, durationMs: 2_000 }])).toBe("tempfail");
  });

  test("a real worker failure (and a slow gate) is productive — it counts toward the cap", () => {
    // Worker ran, did real work, then failed: a genuine attempt.
    expect(
      classifyNonProductiveStepFailure([
        { stepId: "triage", status: "succeeded", exitCode: 0, durationMs: 4_000 },
        { stepId: "worker", status: "failed", exitCode: 1, durationMs: 120_000 },
      ]),
    ).toBeUndefined();
    // A gate step that ran for minutes did real analysis; not a fast gate death.
    expect(classifyNonProductiveStepFailure([{ stepId: "triage", status: "failed", exitCode: 1, durationMs: 120_000 }])).toBeUndefined();
    // No failed/timed-out step at all → nothing to demote.
    expect(classifyNonProductiveStepFailure([{ stepId: "worker", status: "succeeded", exitCode: 0, durationMs: 10 }])).toBeUndefined();
  });
});

describe("Store drain-reliability state machine", () => {
  let root: string;
  let store: Store;
  let oldDataDir: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "loops-drain-reliability-"));
    oldDataDir = process.env.LOOPS_DATA_DIR;
    process.env.LOOPS_DATA_DIR = root;
    store = new Store(join(root, "loops.db"));
  });
  afterEach(() => {
    store.close();
    if (oldDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
    else process.env.LOOPS_DATA_DIR = oldDataDir;
    rmSync(root, { recursive: true, force: true });
  });

  interface AdmittedCtx {
    workItemId: string;
    workflowId: string;
    loopId: string;
  }

  let seq = 0;
  function admit(taskId: string, stepIds: string[]): AdmittedCtx {
    const invocation = store.createWorkflowInvocation({
      templateId: "task-lifecycle",
      sourceRef: { kind: "event", id: `evt-${taskId}-${seq}`, dedupeKey: `todos-task:${taskId}` },
      subjectRef: { kind: "task", id: taskId, path: "/tmp/open-loops" },
      intent: "route",
      scope: { projectPath: "/tmp/open-loops" },
      outputPolicy: { report: "always", createTask: "on_failure" },
    });
    const workItem = store.upsertWorkflowWorkItem({
      routeKey: "todos-task",
      idempotencyKey: `todos-task:${taskId}`,
      invocationId: invocation.id,
      sourceType: "task.created",
      sourceRef: `evt-${taskId}-${seq}`,
      subjectRef: taskId,
      projectKey: "/tmp/open-loops",
    });
    const workflow = store.createWorkflow({
      name: `route-${taskId}-${seq++}`,
      steps: stepIds.map((id) => ({ id, target: { type: "command", command: "true" } })),
    });
    const loop = store.createLoop({
      name: `${workflow.name}-run`,
      schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
      target: { type: "workflow", workflowId: workflow.id, input: { workflowInvocationId: invocation.id, workflowWorkItemId: workItem.id } },
    });
    store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id });
    return { workItemId: workItem.id, workflowId: workflow.id, loopId: loop.id };
  }

  function failRun(ctx: AdmittedCtx, failing: { stepId: string; exitCode: number; durationMs: number; error?: string }): void {
    const workflow = store.getWorkflow(ctx.workflowId)!;
    const loop = store.getLoop(ctx.loopId)!;
    const run = store.createWorkflowRun({ workflow, loop, scheduledFor: "2026-01-01T00:00:00.000Z" });
    store.startWorkflowStepRun(run.id, failing.stepId);
    store.finalizeWorkflowStepRun(run.id, failing.stepId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      durationMs: failing.durationMs,
      exitCode: failing.exitCode,
      stdout: "",
      stderr: failing.error ?? "",
      error: failing.error,
    });
    store.finalizeWorkflowRun(run.id, "failed");
  }

  /** Reach a terminal `failed` item at exactly `attempts`, using only public
   *  APIs and a *productive* worker failure (which keeps the attempt). */
  function terminalFailedAtAttempts(taskId: string, attempts: number): string {
    const steps = ["worker"];
    const productive = { stepId: "worker", exitCode: 1, durationMs: 120_000 };
    const ctx = admit(taskId, steps);
    failRun(ctx, productive);
    for (let a = 1; a < attempts; a += 1) {
      store.requeueWorkflowWorkItem(ctx.workItemId, { reason: "cycle" }); // store default = preserve attempts
      store.admitWorkflowWorkItem(ctx.workItemId, { workflowId: ctx.workflowId, loopId: ctx.loopId });
      failRun(ctx, productive);
    }
    return ctx.workItemId;
  }

  test("(b) a fast triage gate death refunds its attempt (stays failed, off the cap)", () => {
    const ctx = admit("gate-death", ["triage", "worker"]);
    expect(store.getWorkflowWorkItem(ctx.workItemId)?.attempts).toBe(1);
    failRun(ctx, { stepId: "triage", exitCode: 1, durationMs: 3_000 });
    const item = store.getWorkflowWorkItem(ctx.workItemId);
    expect(item?.status).toBe("failed");
    expect(item?.attempts).toBe(0); // refunded: the worker never ran
  });

  test("(c) an exit-75 tempfail makes the item requeueable and refunds its attempt", () => {
    const ctx = admit("tempfail", ["triage", "worker"]);
    expect(store.getWorkflowWorkItem(ctx.workItemId)?.attempts).toBe(1);
    failRun(ctx, { stepId: "worker", exitCode: WORK_ITEM_TEMPFAIL_EXIT_CODE, durationMs: 5_000 });
    const item = store.getWorkflowWorkItem(ctx.workItemId);
    expect(item?.status).toBe("queued"); // requeueable, not a terminal dedupe-bait row
    expect(item?.attempts).toBe(0); // refunded: exit 75 is "retry later", not an attempt
    expect(item?.workflowRunId).toBeUndefined(); // bindings cleared like a requeue
  });

  test("a real worker failure keeps its attempt (still counts toward the cap)", () => {
    const ctx = admit("productive", ["triage", "worker"]);
    failRun(ctx, { stepId: "worker", exitCode: 1, durationMs: 120_000 });
    const item = store.getWorkflowWorkItem(ctx.workItemId);
    expect(item?.status).toBe("failed");
    expect(item?.attempts).toBe(1); // NOT refunded: the worker did real work and failed
  });

  test("(a) dead-letter transitions a terminal item to dead_letter and is idempotent", () => {
    const id = terminalFailedAtAttempts("dl-1", 3);
    expect(store.getWorkflowWorkItem(id)?.status).toBe("failed");
    const dl = store.deadLetterWorkflowWorkItem(id, { reason: "redispatch cap reached (8/8)" });
    expect(dl.status).toBe("dead_letter");
    expect(dl.lastReason).toContain("redispatch cap reached");
    // Idempotent: a second call keeps it dead-lettered (no throw, no downgrade).
    expect(store.deadLetterWorkflowWorkItem(id).status).toBe("dead_letter");
  });

  test("(d) routes requeue resets attempts by default; --keep-attempts preserves them", () => {
    const reset = terminalFailedAtAttempts("rq-reset", 3);
    expect(store.getWorkflowWorkItem(reset)?.attempts).toBe(3);
    const requeuedReset = store.requeueWorkflowWorkItem(reset, { reason: "operator unwedge", resetAttempts: true });
    expect(requeuedReset.status).toBe("queued");
    expect(requeuedReset.attempts).toBe(0); // durable: a fresh terminal run starts the cap over

    const keep = terminalFailedAtAttempts("rq-keep", 3);
    const requeuedKeep = store.requeueWorkflowWorkItem(keep, { reason: "cautious" }); // store default = preserve
    expect(requeuedKeep.attempts).toBe(3); // the bounded route re-admission relies on this
  });
});
