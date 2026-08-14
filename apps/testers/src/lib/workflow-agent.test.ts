process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createScenario } from "../db/scenarios.js";
import { createTestingWorkflow } from "../db/workflows.js";
import { runWorkflowGoalLoop } from "./workflow-agent.js";

describe("workflow goal loop", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  test("runs a goal loop and records AI-planned next actions after a failing iteration", async () => {
    const project = createProject({ name: "shop" });
    const scenario = createScenario({
      projectId: project.id,
      name: "Checkout",
      description: "Checkout should work",
    });
    const workflow = createTestingWorkflow({
      name: "Checkout goal",
      projectId: project.id,
      scenarioFilter: { scenarioIds: [scenario.id] },
      goal: {
        prompt: "Customer can complete checkout",
        successCriteria: ["confirmation is visible"],
        maxIterations: 2,
      },
    });

    const result = await runWorkflowGoalLoop(workflow.id, {
      url: "https://example.com",
      dryRun: true,
      aiGenerate: async () => [
        {
          type: "todo",
          title: "Fix checkout confirmation",
          description: "The workflow goal still needs a confirmation screen assertion.",
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.iterations).toBe(1);
    expect(result.runs[0]?.id).toBe("dry-run");
    expect(result.actions).toEqual([
      {
        type: "todo",
        title: "Fix checkout confirmation",
        description: "The workflow goal still needs a confirmation screen assertion.",
      },
    ]);
  });

  test("rejects workflows without a goal", async () => {
    const workflow = createTestingWorkflow({ name: "No goal" });

    await expect(runWorkflowGoalLoop(workflow.id, {
      url: "https://example.com",
      dryRun: true,
    })).rejects.toThrow("Testing workflow has no goal");
  });
});
