process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTestingWorkflow } from "../db/workflows.js";
import {
  normalizeFanoutWorkerCount,
  resolveWorkflowFanoutSelection,
  runWorkflowFanout,
} from "./workflow-fanout.js";

describe("workflow fanout", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  test("selects saved sandbox workflows by project and tag", () => {
    const project = createProject({ name: "alumia" });
    const selected = createTestingWorkflow({
      name: "projects page",
      projectId: project.id,
      scenarioFilter: { tags: ["projects"] },
      execution: { target: "sandbox", provider: "e2b" },
    });
    createTestingWorkflow({
      name: "billing page",
      projectId: project.id,
      scenarioFilter: { tags: ["billing"] },
      execution: { target: "sandbox", provider: "e2b" },
    });

    const workflows = resolveWorkflowFanoutSelection({
      projectId: project.id,
      tags: ["projects"],
    });

    expect(workflows.map((workflow) => workflow.id)).toEqual([selected.id]);
  });

  test("requires selected workflows to use sandbox execution", () => {
    createTestingWorkflow({ name: "local only", execution: { target: "local" } });

    expect(() => resolveWorkflowFanoutSelection({})).toThrow("requires sandbox workflows");
  });

  test("bounds worker count to the supported 1-12 sandbox range", () => {
    expect(normalizeFanoutWorkerCount(undefined)).toBe(6);
    expect(normalizeFanoutWorkerCount(12)).toBe(12);
    expect(() => normalizeFanoutWorkerCount(0)).toThrow("between 1 and 12");
    expect(() => normalizeFanoutWorkerCount(13)).toThrow("between 1 and 12");
  });

  test("runs workflows with bounded sandbox concurrency", async () => {
    const workflows = Array.from({ length: 5 }, (_, index) => createTestingWorkflow({
      name: `workflow-${index + 1}`,
      execution: { target: "sandbox", provider: "e2b" },
    }));
    let active = 0;
    let maxActive = 0;

    const result = await runWorkflowFanout({
      workflowIds: workflows.map((workflow) => workflow.id),
      url: "https://preview.example",
      workers: 3,
    }, {
      async runTestingWorkflow(workflowId) {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return {
          run: null,
          results: [],
          plan: {
            workflow: workflows.find((workflow) => workflow.id === workflowId)!,
            runOptions: { url: "https://preview.example" },
            sandbox: null,
          },
          sandboxResult: {
            sandboxId: `sb_${workflowId.slice(0, 8)}`,
            sessionId: `sess_${workflowId.slice(0, 8)}`,
            exitCode: 0,
            stdout: "",
            stderr: "",
            cleanup: "deleted",
          },
        };
      },
    });

    expect(result.status).toBe("passed");
    expect(result.total).toBe(5);
    expect(result.passed).toBe(5);
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
