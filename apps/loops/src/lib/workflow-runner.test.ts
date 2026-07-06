import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import type { WorkflowStepInput } from "../types.js";
import { buildHealthReport } from "./health.js";
import { tick } from "./scheduler.js";
import { Store } from "./store.js";
import { createOpenSessionsTraceSink, type OpenSessionsTraceEntry, type OpenSessionsTraceWriter } from "./opensessions-trace.js";
import { prHandoffCommand } from "./template-kit.js";
import { executeLoopTarget, executeWorkflow } from "./workflow-runner.js";
import { workflowBodyFromJson } from "./workflow-spec.js";
import { expectMarkerNeverWritten, gatedWriteCommand, openGate, waitUntil } from "../test-helpers.js";

interface EnvelopeStepSummary {
  stepId: string;
  status: string;
  exitCode?: number;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutExcerpt?: string;
  blocked: boolean;
}

function parseEnvelope(stdout: string): { workflowRun: { status: string }; steps: EnvelopeStepSummary[] } {
  return JSON.parse(stdout) as { workflowRun: { status: string }; steps: EnvelopeStepSummary[] };
}

function generated(object: unknown, totalTokens = 10) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(object) }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: {
      inputTokens: { total: totalTokens, noCache: totalTokens, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: totalTokens, text: totalTokens, reasoning: undefined },
    },
    warnings: [],
  };
}

function mockObjects(objects: unknown[], totalTokens = 10) {
  let index = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => generated(objects[Math.min(index++, objects.length - 1)], totalTokens),
  });
}

class MemoryTraceWriter implements OpenSessionsTraceWriter {
  readonly entries: OpenSessionsTraceEntry[] = [];

  write(entry: OpenSessionsTraceEntry): void {
    this.entries.push(entry);
  }
}

describe("workflow runner", () => {
  test("runs dependent command steps and records step runs and events", async () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "two-step",
        steps: [
          {
            id: "first",
            target: { type: "command", command: "printf first", shell: true },
          },
          {
            id: "second",
            dependsOn: ["first"],
            target: { type: "command", command: "printf second", shell: true },
          },
        ],
      });

      const result = await executeWorkflow(store, workflow);
      expect(result.status).toBe("succeeded");
      const runs = store.listWorkflowRuns({ workflowId: workflow.id });
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe("succeeded");
      const steps = store.listWorkflowStepRuns(runs[0]!.id);
      expect(steps.map((step) => step.status)).toEqual(["succeeded", "succeeded"]);
      expect(steps[0]?.stdout).toContain("first");
      expect(steps[1]?.stdout).toContain("second");
      const events = store.listWorkflowEvents(runs[0]!.id);
      expect(events.map((event) => event.eventType)).toContain("created");
      expect(events.map((event) => event.eventType)).toContain("step_succeeded");
    } finally {
      store.close();
    }
  });

  test("links workflow runs to OpenSessions trace entries without changing workflow events replay", async () => {
    const store = new Store(":memory:");
    const writer = new MemoryTraceWriter();
    try {
      const workflow = store.createWorkflow({
        name: "opensessions-trace",
        steps: [
          {
            id: "command",
            target: {
              type: "command",
              command: "printf 'SECRET_TRACE_OUTPUT_%s' \"$(printf x%.0s {1..9000})\"",
              shell: true,
            },
          },
        ],
      });

      const result = await executeWorkflow(store, workflow, {
        openSessionsTrace: createOpenSessionsTraceSink(writer),
      });

      expect(result.status).toBe("succeeded");
      const run = store.listWorkflowRuns({ workflowId: workflow.id })[0]!;
      const events = store.listWorkflowEvents(run.id);
      expect(events.map((event) => event.eventType)).toContain("created");
      expect(events.map((event) => event.eventType)).toContain("opensessions_trace_attached");
      expect(events.map((event) => event.eventType)).toContain("step_started");
      expect(events.map((event) => event.eventType)).toContain("step_succeeded");
      const traceEvent = events.find((event) => event.eventType === "opensessions_trace_attached");
      expect(traceEvent?.payload?.sessionId).toBe(`openloops-workflow-${run.id}`);
      expect(writer.entries.length).toBeGreaterThanOrEqual(4);
      expect(writer.entries.some((entry) => entry.id.includes("step-command-started"))).toBe(true);
      expect(writer.entries.some((entry) => entry.id.includes("step-command-succeeded"))).toBe(true);
      const traceJson = JSON.stringify(writer.entries);
      expect(traceJson).not.toContain("SECRET_TRACE_OUTPUT");
      expect(traceJson).toContain("[redacted");
    } finally {
      store.close();
    }
  });

  test("scheduled workflow loops create idempotent workflow runs", async () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "scheduled",
        steps: [{ id: "step", target: { type: "command", command: "printf scheduled", shell: true } }],
      });
      const loop = store.createLoop(
        {
          name: "workflow-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "workflow", workflowId: workflow.id },
        },
        new Date("2025-12-31T00:00:00Z"),
      );

      const result = await tick({
        store,
        runnerId: "test",
        now: () => new Date("2026-01-01T00:00:00Z"),
      });

      expect(result.completed).toHaveLength(1);
      expect(result.completed[0]?.status).toBe("succeeded");
      const workflowRuns = store.listWorkflowRuns({ workflowId: workflow.id });
      expect(workflowRuns).toHaveLength(1);
      expect(workflowRuns[0]?.loopId).toBe(loop.id);
      expect(store.listWorkflowStepRuns(workflowRuns[0]!.id)[0]?.stdout).toContain("scheduled");
    } finally {
      store.close();
    }
  });

  test("legacy workflow loops with both loop and workflow goals execute the workflow once", async () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "double-goal-workflow",
        goal: { objective: "Direct workflow goal should be ignored by loop-goal execution", maxTurns: 3 },
        steps: [{ id: "step", target: { type: "command", command: "printf double-goal-ok", shell: true } }],
      });
      const loop = store.createLoop(
        {
          name: "double-goal-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "workflow", workflowId: workflow.id },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      (store as unknown as { db: { query: (sql: string) => { run: (...params: unknown[]) => unknown } } }).db
        .query("UPDATE loops SET goal_json = ? WHERE id = ?")
        .run(JSON.stringify({ objective: "Outer loop goal", maxTurns: 3 }), loop.id);

      const model = mockObjects([
        { nodes: [{ key: "run", objective: "Run the workflow", dependsOn: [], priority: 0, tokenBudget: null }] },
        {
          achieved: true,
          status: "complete",
          evidence: ["workflow command completed"],
          unmetRequirements: [],
          adversarialReview: "Verified that the nested workflow produced one successful workflow run.",
        },
      ]);
      const result = await tick({
        store,
        runnerId: "test",
        now: () => new Date("2026-01-01T00:00:00Z"),
        execute: (claimedLoop, run) => executeLoopTarget(store, claimedLoop, run, { goalModel: model }),
      });

      expect(result.completed).toHaveLength(1);
      expect(result.completed[0]?.status).toBe("succeeded");
      const workflowRuns = store.listWorkflowRuns({ workflowId: workflow.id });
      expect(workflowRuns).toHaveLength(1);
      expect(workflowRuns[0]?.status).toBe("succeeded");
      expect(store.listWorkflowStepRuns(workflowRuns[0]!.id)[0]?.stdout).toContain("double-goal-ok");
      const runtimeGoal = store.findGoalByRunId(result.completed[0]!.id);
      expect(runtimeGoal?.status).toBe("complete");
    } finally {
      store.close();
    }
  });

  test("workflow runtime preflight fails before creating workflow runs", async () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "runtime-preflight-workflow",
        steps: [{ id: "missing", target: { type: "command", command: "openloops-definitely-missing-binary" } }],
      });
      const loop = store.createLoop({
        name: "runtime-preflight-loop",
        schedule: { type: "once", at: new Date().toISOString() },
        target: { type: "workflow", workflowId: workflow.id, preflight: { beforeRun: true } },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();

      const result = await executeLoopTarget(store, loop, claim!.run);

      expect(result.status).toBe("failed");
      expect(result.error).toContain("runtime preflight failed");
      expect(result.error).toContain("workflow step missing preflight failed");
      expect(store.listWorkflowRuns({ workflowId: workflow.id })).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("workflow loop steps inherit the loop machine assignment", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-workflow-machine-"));
    const marker = join(root, "marker");
    try {
      const workflow = store.createWorkflow({
        name: "machine-workflow",
        steps: [{ id: "step", target: { type: "command", command: `printf workflow-remote > ${JSON.stringify(marker)}`, shell: true } }],
      });
      const loop = store.createLoop({
        name: "machine-workflow-loop",
        schedule: { type: "once", at: new Date().toISOString() },
        target: { type: "workflow", workflowId: workflow.id },
        machine: { id: "remote-test", local: false, route: "ssh" },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoopTarget(store, loop, claim!.run, {
        machineResolver: (machine) => ({ ...machine, local: false, route: "ssh" }),
        machineCommandResolver: () => ({
          command: "bash",
          args: ["-c", "bash -s"],
          source: "ssh",
        }),
      });
      expect(result.status).toBe("succeeded");
      expect(readFileSync(marker, "utf8")).toBe("workflow-remote");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("validates command argv shape before storing workflows", () => {
    expect(() =>
      workflowBodyFromJson({
        name: "bad-command",
        steps: [{ id: "bad", target: { type: "command", command: "git status --short" } }],
      }),
    ).toThrow("must be an executable without spaces");
  });

  test("cancels running workflow runs and prevents later terminal overwrite", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "cancel",
        steps: [{ id: "step", target: { type: "command", command: "printf never", shell: true } }],
      });
      const run = store.createWorkflowRun({ workflow });
      store.startWorkflowStepRun(run.id, "step");
      const cancelled = store.cancelWorkflowRun(run.id, "test cancellation");
      expect(cancelled.status).toBe("cancelled");
      expect(store.getWorkflowStepRun(run.id, "step")?.status).toBe("cancelled");
      const late = store.finalizeWorkflowRun(run.id, "succeeded");
      expect(late.status).toBe("cancelled");
      expect(store.listWorkflowEvents(run.id).map((event) => event.eventType)).toContain("cancelled");
    } finally {
      store.close();
    }
  });

  test("cancels running workflow child processes before side effects", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-cancel-"));
    const marker = join(root, "late-write");
    const gate = join(root, "gate");
    try {
      const workflow = store.createWorkflow({
        name: "cancel-child",
        steps: [
          {
            id: "slow",
            target: { type: "command", command: gatedWriteCommand(gate, marker), shell: true },
          },
        ],
      });
      const executing = executeWorkflow(store, workflow, { cancelPollMs: 25 });
      const runId = await waitUntil(() => {
        const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
        return run && store.getWorkflowStepRun(run.id, "slow")?.status === "running" ? run.id : undefined;
      }, { label: "workflow step running" });
      expect(runId).toBeDefined();
      store.cancelWorkflowRun(runId!, "test cancellation");
      const result = await executing;
      await expectMarkerNeverWritten(gate, marker);
      expect(result.status).toBe("failed");
      expect(store.requireWorkflowRun(runId!).status).toBe("cancelled");
      expect(store.getWorkflowStepRun(runId!, "slow")?.status).toBe("cancelled");
      expect(existsSync(marker)).toBe(false);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("honors workflow step timeouts", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-timeout-"));
    const marker = join(root, "late-write");
    const gate = join(root, "gate");
    try {
      const workflow = store.createWorkflow({
        name: "timeout-step",
        steps: [
          {
            id: "slow",
            timeoutMs: 50,
            target: { type: "command", command: gatedWriteCommand(gate, marker), shell: true },
          },
        ],
      });
      const result = await executeWorkflow(store, workflow);
      const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0]!;
      const step = store.getWorkflowStepRun(run.id, "slow")!;
      await expectMarkerNeverWritten(gate, marker);
      expect(result.status).toBe("timed_out");
      expect(run.status).toBe("timed_out");
      expect(step.status).toBe("timed_out");
      expect(existsSync(marker)).toBe(false);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("allows explicit unlimited workflow step timeouts", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-unlimited-timeout-"));
    const marker = join(root, "completed");
    try {
      const workflow = store.createWorkflow({
        name: "unlimited-step",
        steps: [
          {
            id: "slow",
            timeoutMs: null,
            target: { type: "command", command: `sleep 0.1; printf done > ${JSON.stringify(marker)}`, shell: true },
          },
        ],
      });
      const result = await executeWorkflow(store, workflow);
      const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0]!;
      const step = store.getWorkflowStepRun(run.id, "slow")!;
      expect(result.status).toBe("succeeded");
      expect(run.status).toBe("succeeded");
      expect(step.status).toBe("succeeded");
      expect(readFileSync(marker, "utf8")).toBe("done");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("expired loop leases also fail linked workflow runs", async () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "lease-workflow",
        steps: [{ id: "step", target: { type: "command", command: "printf ok", shell: true } }],
      });
      const loop = store.createLoop({
        name: "lease-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
        leaseMs: 10,
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00Z", "test", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      const workflowRun = store.createWorkflowRun({ workflow, loop, loopRun: claim!.run });
      store.startWorkflowStepRun(workflowRun.id, "step");
      const recovered = store.recoverExpiredRunLeases(new Date("2026-01-01T00:00:01Z"));
      expect(recovered[0]?.status).toBe("abandoned");
      expect(store.requireWorkflowRun(workflowRun.id).status).toBe("failed");
      expect(store.getWorkflowStepRun(workflowRun.id, "step")?.status).toBe("skipped");
      expect(store.listWorkflowEvents(workflowRun.id).map((event) => event.eventType)).toContain("failed");
    } finally {
      store.close();
    }
  });

  test("workflow loop retries create a new workflow run per attempt", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-retry-"));
    const marker = join(root, "first-attempt");
    try {
      const workflow = store.createWorkflow({
        name: "retry-workflow",
        steps: [
          {
            id: "flaky",
            target: {
              type: "command",
              command: `if [ ! -f ${JSON.stringify(marker)} ]; then touch ${JSON.stringify(marker)}; exit 42; fi; printf recovered`,
              shell: true,
            },
          },
        ],
      });
      store.createLoop({
        name: "retry-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
        maxAttempts: 2,
        retryDelayMs: 1,
      });
      const first = await tick({
        store,
        runnerId: "test",
        now: () => new Date("2026-01-01T00:00:00Z"),
      });
      expect(first.completed[0]?.status).toBe("failed");
      expect(first.completed[0]?.attempt).toBe(1);
      const retryAt = store.getLoop(first.completed[0]!.loopId)?.nextRunAt;
      expect(retryAt).toBeDefined();
      const second = await tick({
        store,
        runnerId: "test",
        now: () => new Date(retryAt!),
      });
      expect(second.completed[0]?.status).toBe("succeeded");
      expect(second.completed[0]?.attempt).toBe(2);
      const workflowRuns = store.listWorkflowRuns({ workflowId: workflow.id, limit: 5 });
      expect(workflowRuns).toHaveLength(2);
      expect(workflowRuns.map((run) => run.status).sort()).toEqual(["failed", "succeeded"]);
      const latest = workflowRuns.find((run) => run.status === "succeeded")!;
      expect(store.getWorkflowStepRun(latest.id, "flaky")?.stdout).toContain("recovered");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("workflow provider DNS failures are reported as retry-pending provider outages", async () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "machine-tasks-inprogress-completion-audit-workflow",
        steps: [
          {
            id: "cursor-inprogress-audit",
            target: {
              type: "command",
              command: "printf 'Error: [unavailable] getaddrinfo EAI_AGAIN api2.cursor.sh' >&2; exit 1",
              shell: true,
            },
          },
        ],
      });
      const loop = store.createLoop(
        {
          name: "machine-tasks-in-progress-audit",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "workflow", workflowId: workflow.id },
          maxAttempts: 2,
          retryDelayMs: 1_000,
        },
        new Date("2025-12-31T00:00:00Z"),
      );

      const first = await tick({
        store,
        runnerId: "test",
        now: () => new Date("2026-01-01T00:00:00Z"),
        random: () => 0.5,
      });

      expect(first.completed[0]?.status).toBe("failed");
      expect(first.completed[0]?.attempt).toBe(1);
      const retrying = store.getLoop(loop.id);
      expect(retrying?.status).toBe("active");
      expect(retrying?.retryScheduledFor).toBe("2026-01-01T00:00:00.000Z");
      expect(retrying?.nextRunAt).toBeDefined();
      expect(retrying?.nextRunAt).not.toBe(retrying?.retryScheduledFor);

      const report = buildHealthReport(store);
      const expectation = report.expectations.find((entry) => entry.loop.id === loop.id);
      expect(report.ok).toBe(true);
      expect(report.summary.unhealthy).toBe(0);
      expect(report.summary.warnings).toBe(1);
      expect(report.classifications.provider_unavailable).toBe(1);
      expect(expectation?.ok).toBe(true);
      expect(expectation?.check.status).toBe("warn");
      expect(expectation?.check.message).toContain("retry is scheduled");
      expect(expectation?.loop.retryScheduledFor).toBe("2026-01-01T00:00:00.000Z");
      expect(expectation?.failure?.classification).toBe("provider_unavailable");
      expect(expectation?.failure?.evidence.summary).toBe("provider DNS lookup failed: EAI_AGAIN api2.cursor.sh");
      expect(expectation?.recommendedTask).toBeUndefined();
    } finally {
      store.close();
    }
  });

  test("same idempotency key cannot double-run an active workflow step", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-idempotent-active-"));
    const marker = join(root, "marker");
    const gate = join(root, "gate");
    try {
      const workflow = store.createWorkflow({
        name: "active-idempotency",
        steps: [
          {
            id: "slow",
            target: { type: "command", command: gatedWriteCommand(gate, marker, { text: "x", append: true }), shell: true },
          },
        ],
      });
      const first = executeWorkflow(store, workflow, { idempotencyKey: "same-active-run" });
      const second = executeWorkflow(store, workflow, { idempotencyKey: "same-active-run" }).catch((error) => error);
      const secondResult = await second;
      openGate(gate);
      const firstResult = await first;
      expect(firstResult.status).toBe("succeeded");
      expect(secondResult).toBeInstanceOf(Error);
      expect(String(secondResult.message)).toContain("not claimable");
      expect(readFileSync(marker, "utf8")).toBe("x");
      expect(store.listWorkflowRuns({ workflowId: workflow.id })).toHaveLength(1);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("workflow target timeout records timed_out on loop and workflow runs", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-workflow-timeout-"));
    const marker = join(root, "late-write");
    const gate = join(root, "gate");
    try {
      const workflow = store.createWorkflow({
        name: "workflow-target-timeout",
        steps: [
          {
            id: "slow",
            target: { type: "command", command: gatedWriteCommand(gate, marker), shell: true },
          },
        ],
      });
      store.createLoop({
        name: "workflow-timeout-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflow.id, timeoutMs: 50 },
      });
      const result = await tick({
        store,
        runnerId: "test",
        now: () => new Date("2026-01-01T00:00:00Z"),
      });
      const workflowRun = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0]!;
      const step = store.getWorkflowStepRun(workflowRun.id, "slow")!;
      await expectMarkerNeverWritten(gate, marker);
      expect(result.completed[0]?.status).toBe("timed_out");
      expect(workflowRun.status).toBe("timed_out");
      expect(step.status).toBe("timed_out");
      expect(step.error).toBe("workflow timed out after 50ms");
      expect(existsSync(marker)).toBe(false);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("expired loop lease recovery waits for live workflow step pids", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-live-lease-"));
    const marker = join(root, "marker");
    const gate = join(root, "gate");
    try {
      const workflow = store.createWorkflow({
        name: "live-lease",
        steps: [
          {
            id: "slow",
            target: { type: "command", command: gatedWriteCommand(gate, marker, { text: "x", append: true }), shell: true },
          },
        ],
      });
      const loop = store.createLoop({
        name: "live-lease-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
        leaseMs: 50,
        maxAttempts: 2,
        retryDelayMs: 1,
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "crashed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      const executing = executeWorkflow(store, workflow, {
        loop,
        loopRun: claim!.run,
        scheduledFor: claim!.run.scheduledFor,
        idempotencyKey: `${loop.id}:${claim!.run.scheduledFor}:attempt:${claim!.run.attempt}`,
      });
      const runId = await waitUntil(() => {
        const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
        const step = run ? store.getWorkflowStepRun(run.id, "slow") : undefined;
        return run && step?.status === "running" && step.pid !== undefined ? run.id : undefined;
      }, { label: "workflow step running with pid" });
      expect(runId).toBeDefined();
      const recovered = store.recoverExpiredRunLeases(new Date("2026-01-01T00:00:01Z"));
      expect(recovered).toHaveLength(0);
      expect(store.getRun(claim!.run.id)?.status).toBe("running");
      expect(store.requireWorkflowRun(runId!).status).toBe("running");
      const tickResult = await tick({
        store,
        runnerId: "retry",
        now: () => new Date("2026-01-01T00:00:01Z"),
      });
      expect(tickResult.completed).toHaveLength(0);
      expect(store.listWorkflowRuns({ workflowId: workflow.id })).toHaveLength(1);
      openGate(gate);
      const result = await executing;
      expect(result.status).toBe("succeeded");
      expect(readFileSync(marker, "utf8")).toBe("x");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("overlap allow does not reclaim expired workflow runs with live step pids", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-live-overlap-"));
    const marker = join(root, "marker");
    const gate = join(root, "gate");
    try {
      const workflow = store.createWorkflow({
        name: "live-overlap",
        steps: [
          {
            id: "slow",
            target: { type: "command", command: gatedWriteCommand(gate, marker, { text: "x", append: true }), shell: true },
          },
        ],
      });
      const loop = store.createLoop({
        name: "live-overlap-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
        leaseMs: 50,
        maxAttempts: 2,
        retryDelayMs: 1,
        overlap: "allow",
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "crashed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      const executing = executeWorkflow(store, workflow, {
        loop,
        loopRun: claim!.run,
        scheduledFor: claim!.run.scheduledFor,
        idempotencyKey: `${loop.id}:${claim!.run.scheduledFor}:attempt:${claim!.run.attempt}`,
      });
      const runId = await waitUntil(() => {
        const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
        const step = run ? store.getWorkflowStepRun(run.id, "slow") : undefined;
        return run && step?.status === "running" && step.pid !== undefined ? run.id : undefined;
      }, { label: "workflow step running with pid" });
      expect(runId).toBeDefined();
      const tickResult = await tick({
        store,
        runnerId: "reclaimer",
        now: () => new Date("2026-01-01T00:00:01Z"),
      });
      expect(tickResult.completed).toHaveLength(0);
      expect(tickResult.recovered).toHaveLength(0);
      expect(store.getRun(claim!.run.id)?.status).toBe("running");
      expect(store.listWorkflowRuns({ workflowId: workflow.id })).toHaveLength(1);
      openGate(gate);
      const result = await executing;
      expect(result.status).toBe("succeeded");
      expect(readFileSync(marker, "utf8")).toBe("x");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("expired command loop lease recovery waits for live run pids", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-live-command-"));
    const marker = join(root, "marker");
    const gate = join(root, "gate");
    try {
      const loop = store.createLoop({
        name: "live-command-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: gatedWriteCommand(gate, marker, { text: "x", append: true }), shell: true },
        leaseMs: 50,
        maxAttempts: 2,
        retryDelayMs: 1,
        overlap: "allow",
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "crashed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      const executing = executeLoopTarget(store, loop, claim!.run, {
        onSpawn: (pid) => store.markRunPid(claim!.run.id, pid, "crashed"),
      });
      await waitUntil(() => store.getRun(claim!.run.id)?.pid !== undefined, { label: "run pid recorded" });
      expect(store.getRun(claim!.run.id)?.pid).toBeDefined();
      const recovered = store.recoverExpiredRunLeases(new Date("2026-01-01T00:00:01Z"));
      expect(recovered).toHaveLength(0);
      const tickResult = await tick({
        store,
        runnerId: "retry",
        now: () => new Date("2026-01-01T00:00:01Z"),
      });
      expect(tickResult.completed).toHaveLength(0);
      expect(tickResult.recovered).toHaveLength(0);
      expect(store.getRun(claim!.run.id)?.status).toBe("running");
      openGate(gate);
      const result = await executing;
      expect(result.status).toBe("succeeded");
      expect(readFileSync(marker, "utf8")).toBe("x");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("recovers interrupted running workflow steps to pending", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "recover",
        steps: [{ id: "step", target: { type: "command", command: "printf ok", shell: true } }],
      });
      const run = store.createWorkflowRun({ workflow });
      store.startWorkflowStepRun(run.id, "step");
      const recovered = store.recoverWorkflowRun(run.id, "manual test recovery");
      expect(recovered.recoveredSteps).toHaveLength(1);
      expect(store.getWorkflowStepRun(run.id, "step")?.status).toBe("pending");
      expect(store.listWorkflowEvents(run.id).map((event) => event.eventType)).toContain("recovered");
    } finally {
      store.close();
    }
  });

  test("bounds parent run envelopes to per-step summaries", async () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "big-output",
        steps: [
          { id: "noisy", target: { type: "command", command: "printf 'x%.0s' $(seq 1 20000)", shell: true } },
        ],
      });
      const result = await executeWorkflow(store, workflow);
      expect(result.status).toBe("succeeded");
      const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0]!;
      const step = store.getWorkflowStepRun(run.id, "noisy")!;
      expect(step.stdout).toHaveLength(20_000);
      const envelope = parseEnvelope(result.stdout);
      expect(envelope.steps[0]?.stdoutBytes).toBe(20_000);
      expect(envelope.steps[0]?.stdoutExcerpt).toContain("chars omitted");
      expect(result.stdout).not.toContain("x".repeat(5_000));
      expect(result.stdout.length).toBeLessThan(10_000);
    } finally {
      store.close();
    }
  });

  test("maps gate blocked exit codes to skipped without failing the loop run", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-gate-blocked-"));
    const marker = join(root, "marker");
    try {
      const workflow = store.createWorkflow({
        name: "gate-blocked",
        steps: [
          { id: "triage-gate", target: { type: "command", command: "printf policy-blocked; exit 12", shell: true } },
          {
            id: "work",
            dependsOn: ["triage-gate"],
            target: { type: "command", command: `printf ran > ${JSON.stringify(marker)}`, shell: true },
          },
        ],
      });
      store.createLoop({
        name: "gate-blocked-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "workflow", workflowId: workflow.id },
      });
      const result = await tick({
        store,
        runnerId: "test",
        now: () => new Date("2026-01-01T00:00:00Z"),
      });

      expect(result.completed).toHaveLength(1);
      expect(result.completed[0]?.status).toBe("succeeded");
      const workflowRun = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0]!;
      expect(workflowRun.status).toBe("succeeded");
      const gate = store.getWorkflowStepRun(workflowRun.id, "triage-gate")!;
      expect(gate.status).toBe("skipped");
      expect(gate.exitCode).toBe(12);
      expect(gate.error).toStartWith("blocked:");
      expect(gate.stdout).toContain("policy-blocked");
      const work = store.getWorkflowStepRun(workflowRun.id, "work")!;
      expect(work.status).toBe("skipped");
      expect(work.error).toStartWith("blocked:");
      expect(existsSync(marker)).toBe(false);
      const envelope = parseEnvelope(store.getRun(result.completed[0]!.id)?.stdout ?? "");
      expect(envelope.steps.map((step) => step.blocked)).toEqual([true, true]);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("gate steps still fail on non-blocked exit codes", async () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "gate-failed",
        steps: [{ id: "triage-gate", target: { type: "command", command: "exit 1", shell: true } }],
      });
      const result = await executeWorkflow(store, workflow);
      expect(result.status).toBe("failed");
      const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0]!;
      expect(run.status).toBe("failed");
      expect(store.getWorkflowStepRun(run.id, "triage-gate")?.status).toBe("failed");
    } finally {
      store.close();
    }
  });

  test("steps merely containing 'gate' as a substring never inherit blocked-exit semantics", async () => {
    const store = new Store(":memory:");
    try {
      const steps: Array<{ id: string; name?: string }> = [
        { id: "sync-gateway" },
        { id: "aggregate-results" },
        { id: "delegate", name: "investigate results" },
      ];
      for (const step of steps) {
        const workflow = store.createWorkflow({
          name: `gate-substring-${step.id}`,
          steps: [{ ...step, target: { type: "command", command: "exit 12", shell: true } }],
        });
        const result = await executeWorkflow(store, workflow);
        expect(result.status).toBe("failed");
        const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0]!;
        expect(run.status).toBe("failed");
        const stepRun = store.getWorkflowStepRun(run.id, step.id)!;
        expect(stepRun.status).toBe("failed");
        expect(stepRun.error ?? "").not.toStartWith("blocked:");
      }
    } finally {
      store.close();
    }
  });

  test("honors explicit blockedExitCodes overrides on any step", async () => {
    const store = new Store(":memory:");
    try {
      const blockingStep: WorkflowStepInput & { blockedExitCodes: number[] } = {
        id: "check",
        blockedExitCodes: [3],
        target: { type: "command", command: "exit 3", shell: true },
      };
      const optedOutGate: WorkflowStepInput & { blockedExitCodes: number[] } = {
        id: "strict-gate",
        blockedExitCodes: [],
        target: { type: "command", command: "exit 12", shell: true },
      };
      const blocking = store.createWorkflow({ name: "custom-blocked", steps: [blockingStep] });
      const optedOut = store.createWorkflow({ name: "gate-opt-out", steps: [optedOutGate] });

      const blockedResult = await executeWorkflow(store, blocking);
      expect(blockedResult.status).toBe("succeeded");
      const blockedRun = store.listWorkflowRuns({ workflowId: blocking.id, limit: 1 })[0]!;
      expect(store.getWorkflowStepRun(blockedRun.id, "check")?.status).toBe("skipped");
      expect(store.getWorkflowStepRun(blockedRun.id, "check")?.error).toStartWith("blocked:");

      const failedResult = await executeWorkflow(store, optedOut);
      expect(failedResult.status).toBe("failed");
      const failedRun = store.listWorkflowRuns({ workflowId: optedOut.id, limit: 1 })[0]!;
      expect(store.getWorkflowStepRun(failedRun.id, "strict-gate")?.status).toBe("failed");
    } finally {
      store.close();
    }
  });

  test("goal workflow runs execute each plan node with its own objective", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-goal-objectives-"));
    const marker = join(root, "objectives");
    try {
      const workflow = store.createWorkflow({
        name: "goal-objectives",
        goal: { objective: "run every node objective", maxTurns: 5 },
        steps: [
          {
            id: "echo",
            target: { type: "command", command: `printf '%s\\n' "$LOOPS_GOAL_NODE_OBJECTIVE" >> ${JSON.stringify(marker)}`, shell: true },
          },
        ],
      });
      const model = mockObjects([
        {
          nodes: [
            { key: "alpha", objective: "alpha objective", dependsOn: [], priority: 0, tokenBudget: null },
            { key: "beta", objective: "beta objective", dependsOn: ["alpha"], priority: 0, tokenBudget: null },
          ],
        },
        {
          achieved: true,
          status: "complete",
          evidence: ["both node objectives were rendered"],
          unmetRequirements: [],
          adversarialReview: "Verified each node execution received its own objective.",
        },
      ]);
      const result = await executeWorkflow(store, workflow, { goalModel: model });
      expect(result.status).toBe("succeeded");
      expect(store.listWorkflowRuns({ workflowId: workflow.id })).toHaveLength(2);
      expect(readFileSync(marker, "utf8")).toBe("alpha objective\nbeta objective\n");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses recovery while a recorded step process is still alive", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-live-recover-"));
    const marker = join(root, "marker");
    const gate = join(root, "gate");
    try {
      const workflow = store.createWorkflow({
        name: "live-recover",
        steps: [
          {
            id: "slow",
            target: { type: "command", command: gatedWriteCommand(gate, marker, { text: "x", append: true }), shell: true },
          },
        ],
      });
      const executing = executeWorkflow(store, workflow, { idempotencyKey: "live-recover" });
      const runId = await waitUntil(() => {
        const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
        const step = run ? store.getWorkflowStepRun(run.id, "slow") : undefined;
        return run && step?.status === "running" && step.pid !== undefined ? run.id : undefined;
      }, { label: "workflow step running with pid" });
      expect(runId).toBeDefined();
      expect(() => store.recoverWorkflowRun(runId!, "must not duplicate live work")).toThrow("still alive");
      expect(store.getWorkflowStepRun(runId!, "slow")?.status).toBe("running");
      openGate(gate);
      const result = await executing;
      expect(result.status).toBe("succeeded");
      expect(readFileSync(marker, "utf8")).toBe("x");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Regression (MEDIUM 2): a resumed idempotent workflow run (e.g. its loop run's
  // lease was stolen and re-claimed at the same attempt) may carry steps left
  // "running" by the interrupted, now-dead executor. Those steps are not
  // claimable and would strand the workflow. On resume the dead steps are
  // recovered to pending and re-run instead of orphaning the workflow forever.
  test("resumed idempotent workflow run recovers steps left running with a dead pid", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-resume-recover-"));
    const marker = join(root, "marker");
    const DEAD_PID = 0x3fffffff;
    try {
      const workflow = store.createWorkflow({
        name: "resume-recover",
        steps: [{ id: "write", target: { type: "command", command: `printf done > ${marker}`, shell: true } }],
      });
      // Simulate an interrupted executor: the step is "running" with a dead pid.
      const stranded = store.createWorkflowRun({ workflow, idempotencyKey: "resume-key" });
      store.startWorkflowStepRun(stranded.id, "write");
      store.markWorkflowStepPid(stranded.id, "write", DEAD_PID);
      expect(store.getWorkflowStepRun(stranded.id, "write")?.status).toBe("running");

      // Re-run with the same idempotency key: createWorkflowRun returns the
      // stranded run, recovery resets the dead step, and it re-executes.
      const result = await executeWorkflow(store, workflow, { idempotencyKey: "resume-key" });

      expect(result.status).toBe("succeeded");
      expect(store.listWorkflowRuns({ workflowId: workflow.id })).toHaveLength(1);
      expect(store.getWorkflowStepRun(stranded.id, "write")?.status).toBe("succeeded");
      expect(readFileSync(marker, "utf8").trim()).toBe("done");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Regression (MEDIUM 3): an unexpected throw inside the step loop (e.g. a store
  // error like SQLITE_BUSY past busy_timeout) must not leave the workflow_run
  // stuck "running" forever — it is finalized failed and a failed result returned.
  test("executeWorkflow finalizes the workflow run failed when the step loop throws unexpectedly", async () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "loop-throws",
        steps: [{ id: "only", target: { type: "command", command: "true" } }],
      });
      // beforePersist runs inside the step loop; throwing an unexpected error
      // there stands in for any mid-loop store failure.
      const result = await executeWorkflow(store, workflow, {
        beforePersist: () => {
          throw new Error("disk on fire");
        },
      });

      expect(result.status).toBe("failed");
      expect(result.error).toContain("disk on fire");
      const runs = store.listWorkflowRuns({ workflowId: workflow.id });
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe("failed");
    } finally {
      store.close();
    }
  });
});

describe("pr-handoff direct-PR integration", () => {
  test("cursor pattern (worker opens PR, no artifact): pr-handoff exits 0 so the verifier still runs", async () => {
    const store = new Store(":memory:");
    const home = mkdtempSync(join(tmpdir(), "loops-prh-int-home-"));
    const bin = mkdtempSync(join(tmpdir(), "loops-prh-int-bin-"));
    const wt = mkdtempSync(join(tmpdir(), "loops-prh-int-wt-"));
    try {
      // Reproduce the systemd login-shell exit-code corruption: a login shell
      // (`bash -lc`, as command steps run) sources ~/.bash_logout on exit; a
      // failing command there turns the pre-fix explicit `exit 0` into exit 1.
      writeFileSync(join(home, ".bash_logout"), "false\n");
      execFileSync("git", ["init", "-q", wt]);
      execFileSync("git", ["-C", wt, "config", "user.email", "t@t"]);
      execFileSync("git", ["-C", wt, "config", "user.name", "t"]);
      execFileSync("git", ["-C", wt, "commit", "-q", "--allow-empty", "-m", "init"]);
      execFileSync("git", ["-C", wt, "checkout", "-q", "-b", "feat/direct-pr"]);
      execFileSync("git", ["-C", wt, "commit", "-q", "--allow-empty", "-m", "work"]);
      const head = execFileSync("git", ["-C", wt, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

      const gh = join(bin, "gh");
      writeFileSync(
        gh,
        [
          "#!/usr/bin/env bash",
          'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
          `  printf '%s\\n' '[{"url":"https://github.com/acme/repo/pull/11","number":11,"headRefName":"feat/direct-pr","headRefOid":"${head}"}]'`,
          "  exit 0",
          "fi",
          "exit 0",
        ].join("\n"),
      );
      chmodSync(gh, 0o755);
      const cap = join(bin, "todos.cap");
      const todos = join(bin, "todos");
      writeFileSync(todos, ["#!/usr/bin/env bash", `printf '%s\\0' "$@" >> ${JSON.stringify(cap)}`, "exit 0"].join("\n"));
      chmodSync(todos, 0o755);

      const prHandoff = prHandoffCommand({
        artifactPath: join(wt, ".openloops", "pr-handoff", "missing.json"),
        taskId: "task-int-direct-pr",
        todosProjectPath: wt,
        worktreeCwd: wt,
        worktreeRoot: wt,
        expectedBranch: "feat/direct-pr",
      });

      // worker -> pr-handoff -> verifier, mirroring the task-lifecycle wiring
      // where verifier dependsOn pr-handoff when --pr-handoff is set.
      const workflow = store.createWorkflow({
        name: "cursor-direct-pr",
        steps: [
          { id: "worker", target: { type: "command", command: "bash", args: ["-lc", "printf worker-opened-pr-no-artifact"] } },
          {
            id: "pr-handoff",
            dependsOn: ["worker"],
            target: { type: "command", command: "bash", args: ["-lc", prHandoff], cwd: wt, timeoutMs: 60_000 },
          },
          { id: "verifier", dependsOn: ["pr-handoff"], target: { type: "command", command: "bash", args: ["-lc", "printf VERIFIER_RAN"] } },
        ],
      });

      const env = {
        HOME: home,
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        OPENLOOPS_PR_HANDOFF_GH_BIN: gh,
        OPENLOOPS_PR_HANDOFF_TODOS_BIN: todos,
        OPENLOOPS_PR_HANDOFF_GIT_BIN: "git",
      };
      // Canary documents that this env reproduces the corruption for explicit exit.
      const canary = spawnSync("bash", ["-lc", "set -e; printf x; exit 0"], { env, encoding: "utf8" });

      const result = await executeWorkflow(store, workflow, { env });

      const runs = store.listWorkflowRuns({ workflowId: workflow.id });
      expect(runs).toHaveLength(1);
      const steps = store.listWorkflowStepRuns(runs[0]!.id);
      const byId = Object.fromEntries(steps.map((step) => [step.stepId, step]));
      // The whole point: pr-handoff succeeds on the no-artifact path...
      expect(byId["pr-handoff"]?.status).toBe("succeeded");
      expect(byId["pr-handoff"]?.exitCode).toBe(0);
      // ...so the verifier is NOT skipped — it runs after pr-handoff.
      expect(byId["verifier"]?.status).toBe("succeeded");
      expect(byId["verifier"]?.stdout).toContain("VERIFIER_RAN");
      expect(result.status).toBe("succeeded");
      // The worker-opened PR was detected and recorded as the handoff result.
      const captured = existsSync(cap) ? readFileSync(cap, "utf8") : "";
      expect(captured).toContain("openloops:pr-handoff=done");
      expect(captured).toContain("pr=https://github.com/acme/repo/pull/11");
      // On corruption-reproducing envs (canary === 1) the pre-fix explicit exit 0
      // would have failed pr-handoff and skipped the verifier.
      if (canary.status === 1) expect(byId["verifier"]?.status).toBe("succeeded");
    } finally {
      store.close();
      rmSync(home, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });
});
