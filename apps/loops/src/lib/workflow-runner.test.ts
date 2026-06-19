import { describe, expect, test } from "bun:test";
import { tick } from "./scheduler.js";
import { Store } from "./store.js";
import { executeWorkflow } from "./workflow-runner.js";

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
});
