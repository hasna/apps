import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { tick } from "./scheduler.js";
import { Store } from "./store.js";
import { executeLoopTarget, executeWorkflow } from "./workflow-runner.js";
import { workflowBodyFromJson } from "./workflow-spec.js";

function generated(object: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(object) }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 10, text: 10, reasoning: undefined },
    },
    warnings: [],
  };
}

function mockObjects(objects: unknown[]) {
  let index = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => generated(objects[Math.min(index++, objects.length - 1)]),
  });
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

  test("workflow-level goals add explicit goal context to agent step prompts", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-workflow-goal-agent-"));
    const fake = join(root, "claude");
    await Bun.write(
      fake,
      [
        "#!/usr/bin/env bash",
        'prompt_file="$PWD/$LOOPS_WORKFLOW_STEP_ID.prompt"',
        "{",
        "printf 'env_goal=%s\\n' \"$LOOPS_GOAL_ID\"",
        "printf 'env_objective=%s\\n' \"$LOOPS_GOAL_OBJECTIVE\"",
        "printf 'env_node=%s\\n' \"$LOOPS_GOAL_NODE_KEY\"",
        "printf 'env_node_objective=%s\\n' \"$LOOPS_GOAL_NODE_OBJECTIVE\"",
        "printf 'stdin:\\n'",
        "cat",
        '} > "$prompt_file"',
        "printf workflow-agent-ok",
      ].join("\n"),
    );
    chmodSync(fake, 0o755);
    try {
      const model = mockObjects([
        {
          nodes: [
            {
              key: "workflow-node",
              objective: "run the workflow agent step with goal context",
              dependsOn: [],
              priority: 0,
              tokenBudget: null,
            },
          ],
        },
        {
          achieved: true,
          status: "complete",
          evidence: ["workflow agent step received explicit goal context"],
          unmetRequirements: [],
          adversarialReview: "The captured workflow step prompt includes goal id, top objective, node objective, criteria, and original prompt.",
        },
      ]);
      const workflow = store.createWorkflow({
        name: "goal-workflow-agent",
        goal: { objective: "ship workflow goal context", maxTurns: 2 },
        steps: [
          {
            id: "agent-step",
            target: {
              type: "agent",
              provider: "claude",
              prompt: "Workflow agent prompt.",
              cwd: root,
              configIsolation: "safe",
            },
          },
        ],
      });

      const result = await executeWorkflow(store, workflow, {
        model,
        env: { ...process.env, PATH: `${root}:${process.env.PATH}` },
      });

      expect(result.status).toBe("succeeded");
      const prompt = readFileSync(join(root, "agent-step.prompt"), "utf8");
      expect(prompt).toContain("env_goal=");
      expect(prompt).toContain("env_objective=ship workflow goal context");
      expect(prompt).toContain("env_node=workflow-node");
      expect(prompt).toContain("env_node_objective=run the workflow agent step with goal context");
      expect(prompt).toContain("OpenLoops goal context:");
      expect(prompt).toContain("Top objective: ship workflow goal context");
      expect(prompt).toContain("Current node: workflow-node");
      expect(prompt).toContain("Current node objective: run the workflow agent step with goal context");
      expect(prompt).toContain("Acceptance criteria:");
      expect(prompt).toContain("Explicit node instruction:");
      expect(prompt).toContain("Original target prompt:");
      expect(prompt).toContain("Workflow agent prompt.");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("nested workflow and step goals preserve the parent goal context in agent prompts", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-nested-goal-agent-"));
    const fake = join(root, "claude");
    await Bun.write(
      fake,
      [
        "#!/usr/bin/env bash",
        'prompt_file="$PWD/$LOOPS_WORKFLOW_STEP_ID.nested.prompt"',
        "{",
        "printf 'env_goal=%s\\n' \"$LOOPS_GOAL_ID\"",
        "printf 'env_objective=%s\\n' \"$LOOPS_GOAL_OBJECTIVE\"",
        "printf 'env_node=%s\\n' \"$LOOPS_GOAL_NODE_KEY\"",
        "printf 'env_node_objective=%s\\n' \"$LOOPS_GOAL_NODE_OBJECTIVE\"",
        "printf 'stdin:\\n'",
        "cat",
        '} > "$prompt_file"',
        "printf nested-workflow-agent-ok",
      ].join("\n"),
    );
    chmodSync(fake, 0o755);
    try {
      const model = mockObjects([
        {
          nodes: [
            {
              key: "outer-node",
              objective: "run the workflow",
              dependsOn: [],
              priority: 0,
              tokenBudget: null,
            },
          ],
        },
        {
          nodes: [
            {
              key: "step-node",
              objective: "run the nested step agent",
              dependsOn: [],
              priority: 0,
              tokenBudget: null,
            },
          ],
        },
        {
          achieved: true,
          status: "complete",
          evidence: ["step goal complete"],
          unmetRequirements: [],
          adversarialReview: "The nested step agent prompt includes both step and parent workflow goal context.",
        },
        {
          achieved: true,
          status: "complete",
          evidence: ["workflow goal complete"],
          unmetRequirements: [],
          adversarialReview: "The workflow goal completed after the nested step goal.",
        },
      ]);
      const workflow = store.createWorkflow({
        name: "nested-goal-workflow",
        goal: { objective: "outer workflow objective", maxTurns: 3 },
        steps: [
          {
            id: "agent-step",
            goal: { objective: "step goal objective", maxTurns: 2 },
            target: {
              type: "agent",
              provider: "claude",
              prompt: "Nested workflow agent prompt.",
              cwd: root,
              configIsolation: "safe",
            },
          },
        ],
      });

      const result = await executeWorkflow(store, workflow, {
        model,
        env: { ...process.env, PATH: `${root}:${process.env.PATH}` },
      });

      expect(result.status).toBe("succeeded");
      const prompt = readFileSync(join(root, "agent-step.nested.prompt"), "utf8");
      expect(prompt).toContain("Top objective: step goal objective");
      expect(prompt).toContain("Current node: step-node");
      expect(prompt).toContain("Current node objective: run the nested step agent");
      expect(prompt).toContain("Parent goal context:");
      expect(prompt).toContain("- Top objective: outer workflow objective");
      expect(prompt).toContain("- Current node: outer-node");
      expect(prompt).toContain("- Current node objective: run the workflow");
      expect(prompt).toContain("Original target prompt:");
      expect(prompt).toContain("Nested workflow agent prompt.");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
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
    try {
      const workflow = store.createWorkflow({
        name: "cancel-child",
        steps: [
          {
            id: "slow",
            target: { type: "command", command: `sleep 1; printf late > ${JSON.stringify(marker)}`, shell: true },
          },
        ],
      });
      const executing = executeWorkflow(store, workflow, { cancelPollMs: 25 });
      let runId: string | undefined;
      for (let i = 0; i < 50; i++) {
        const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
        if (run && store.getWorkflowStepRun(run.id, "slow")?.status === "running") {
          runId = run.id;
          break;
        }
        await Bun.sleep(10);
      }
      expect(runId).toBeDefined();
      store.cancelWorkflowRun(runId!, "test cancellation");
      const result = await executing;
      await Bun.sleep(1_100);
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
    try {
      const workflow = store.createWorkflow({
        name: "timeout-step",
        steps: [
          {
            id: "slow",
            timeoutMs: 50,
            target: { type: "command", command: `sleep 1; printf late > ${JSON.stringify(marker)}`, shell: true },
          },
        ],
      });
      const result = await executeWorkflow(store, workflow);
      const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0]!;
      const step = store.getWorkflowStepRun(run.id, "slow")!;
      await Bun.sleep(1_100);
      expect(result.status).toBe("timed_out");
      expect(run.status).toBe("timed_out");
      expect(step.status).toBe("timed_out");
      expect(existsSync(marker)).toBe(false);
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

  test("same idempotency key cannot double-run an active workflow step", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-idempotent-active-"));
    const marker = join(root, "marker");
    try {
      const workflow = store.createWorkflow({
        name: "active-idempotency",
        steps: [
          {
            id: "slow",
            target: { type: "command", command: `sleep 1; printf x >> ${JSON.stringify(marker)}`, shell: true },
          },
        ],
      });
      const first = executeWorkflow(store, workflow, { idempotencyKey: "same-active-run" });
      const second = executeWorkflow(store, workflow, { idempotencyKey: "same-active-run" }).catch((error) => error);
      const firstResult = await first;
      const secondResult = await second;
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
    try {
      const workflow = store.createWorkflow({
        name: "workflow-target-timeout",
        steps: [
          {
            id: "slow",
            target: { type: "command", command: `sleep 1; printf late > ${JSON.stringify(marker)}`, shell: true },
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
      await Bun.sleep(1_100);
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
    try {
      const workflow = store.createWorkflow({
        name: "live-lease",
        steps: [
          {
            id: "slow",
            target: { type: "command", command: `sleep 1; printf x >> ${JSON.stringify(marker)}`, shell: true },
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
      let runId: string | undefined;
      for (let i = 0; i < 100; i++) {
        const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
        const step = run ? store.getWorkflowStepRun(run.id, "slow") : undefined;
        if (run && step?.status === "running" && step.pid !== undefined) {
          runId = run.id;
          break;
        }
        await Bun.sleep(10);
      }
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
    try {
      const workflow = store.createWorkflow({
        name: "live-overlap",
        steps: [
          {
            id: "slow",
            target: { type: "command", command: `sleep 1; printf x >> ${JSON.stringify(marker)}`, shell: true },
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
      let runId: string | undefined;
      for (let i = 0; i < 100; i++) {
        const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
        const step = run ? store.getWorkflowStepRun(run.id, "slow") : undefined;
        if (run && step?.status === "running" && step.pid !== undefined) {
          runId = run.id;
          break;
        }
        await Bun.sleep(10);
      }
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
    try {
      const loop = store.createLoop({
        name: "live-command-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: `sleep 1; printf x >> ${JSON.stringify(marker)}`, shell: true },
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
      for (let i = 0; i < 100; i++) {
        if (store.getRun(claim!.run.id)?.pid !== undefined) break;
        await Bun.sleep(10);
      }
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

  test("refuses recovery while a recorded step process is still alive", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-live-recover-"));
    const marker = join(root, "marker");
    try {
      const workflow = store.createWorkflow({
        name: "live-recover",
        steps: [
          {
            id: "slow",
            target: { type: "command", command: `sleep 1; printf x >> ${JSON.stringify(marker)}`, shell: true },
          },
        ],
      });
      const executing = executeWorkflow(store, workflow, { idempotencyKey: "live-recover" });
      let runId: string | undefined;
      for (let i = 0; i < 100; i++) {
        const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
        const step = run ? store.getWorkflowStepRun(run.id, "slow") : undefined;
        if (run && step?.status === "running" && step.pid !== undefined) {
          runId = run.id;
          break;
        }
        await Bun.sleep(10);
      }
      expect(runId).toBeDefined();
      expect(() => store.recoverWorkflowRun(runId!, "must not duplicate live work")).toThrow("still alive");
      expect(store.getWorkflowStepRun(runId!, "slow")?.status).toBe("running");
      const result = await executing;
      expect(result.status).toBe("succeeded");
      expect(readFileSync(marker, "utf8")).toBe("x");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
