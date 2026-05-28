process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTestingWorkflow } from "../db/workflows.js";
import { buildWorkflowRunPlan } from "./workflow-runner.js";

describe("workflow runner", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  test("builds local run options from a saved workflow", () => {
    const project = createProject({ name: "project-1" });
    const workflow = createTestingWorkflow({
      name: "checkout",
      projectId: project.id,
      scenarioFilter: { tags: ["checkout"], priority: "high" },
      personaIds: ["p1", "p2"],
      execution: { target: "local", timeoutMs: 90000 },
    });

    const plan = buildWorkflowRunPlan(workflow, { url: "https://example.com", parallel: 3 });

    expect(plan.connectorCommand).toBeNull();
    expect(plan.runOptions).toMatchObject({
      url: "https://example.com",
      projectId: project.id,
      tags: ["checkout"],
      priority: "high",
      personaIds: ["p1", "p2"],
      parallel: 3,
      timeout: 90000,
    });
  });

  test("builds an open-connectors E2B command for sandbox workflows", () => {
    const workflow = createTestingWorkflow({
      name: "sandbox",
      scenarioFilter: { scenarioIds: ["S1", "S2"] },
      execution: {
        target: "connector:e2b",
        operation: "runCommand",
        sandboxTemplate: "bun-playwright",
      },
    });

    const plan = buildWorkflowRunPlan(workflow, { url: "https://preview.example", model: "quick" });

    expect(plan.connectorCommand?.slice(0, 4)).toEqual(["connectors", "run", "e2b", "runCommand"]);
    const payload = JSON.parse(plan.connectorCommand![4]!);
    expect(payload.template).toBe("bun-playwright");
    expect(payload.command).toContain("@hasna/testers");
    expect(payload.command).toContain("--scenario");
    expect(payload.command).toContain("S1,S2");
  });
});
