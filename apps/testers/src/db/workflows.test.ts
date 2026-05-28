process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, resetDatabase } from "./database.js";
import { createProject } from "./projects.js";
import {
  createTestingWorkflow,
  deleteTestingWorkflow,
  getTestingWorkflow,
  listTestingWorkflows,
  updateTestingWorkflow,
} from "./workflows.js";

describe("testing workflows", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  test("creates a reusable local workflow with scenario filters and personas", () => {
    const project = createProject({ name: "shop", path: "/apps/shop" });
    const workflow = createTestingWorkflow({
      name: "checkout regression",
      projectId: project.id,
      scenarioFilter: { tags: ["checkout"], priority: "high" },
      personaIds: ["persona-1", "persona-2"],
      goal: {
        prompt: "Prove a customer can complete checkout",
        successCriteria: ["order confirmation is visible"],
      },
    });

    expect(workflow.projectId).toBe(project.id);
    expect(workflow.scenarioFilter).toEqual({ tags: ["checkout"], priority: "high" });
    expect(workflow.personaIds).toEqual(["persona-1", "persona-2"]);
    expect(workflow.goal?.maxIterations).toBe(10);
    expect(workflow.execution.target).toBe("local");
    expect(workflow.enabled).toBe(true);
  });

  test("persists connector-backed E2B execution config without storing secrets", () => {
    const workflow = createTestingWorkflow({
      name: "sandbox smoke",
      execution: {
        target: "connector:e2b",
        sandboxTemplate: "node-bun-playwright",
        timeoutMs: 120000,
        env: { APP_ENV: "preview" },
      },
    });

    expect(workflow.execution).toEqual({
      target: "connector:e2b",
      connector: "e2b",
      operation: "run",
      sandboxTemplate: "node-bun-playwright",
      timeoutMs: 120000,
      env: { APP_ENV: "preview" },
    });
  });

  test("gets by id prefix or name and filters by project/enabled", () => {
    const project = createProject({ name: "alpha" });
    const active = createTestingWorkflow({ name: "active", projectId: project.id });
    createTestingWorkflow({ name: "disabled", projectId: project.id, enabled: false });
    createTestingWorkflow({ name: "other" });

    expect(getTestingWorkflow(active.id.slice(0, 8))?.id).toBe(active.id);
    expect(getTestingWorkflow("active")?.id).toBe(active.id);
    expect(listTestingWorkflows({ projectId: project.id, enabled: true }).map((w) => w.name)).toEqual(["active"]);
  });

  test("updates and deletes workflows", () => {
    const workflow = createTestingWorkflow({ name: "before" });
    const updated = updateTestingWorkflow(workflow.id, {
      name: "after",
      enabled: false,
      execution: { target: "connector:e2b", operation: "runCommand" },
    });

    expect(updated.name).toBe("after");
    expect(updated.enabled).toBe(false);
    expect(updated.execution.target).toBe("connector:e2b");
    expect(updated.execution.operation).toBe("runCommand");

    expect(deleteTestingWorkflow(workflow.id)).toBe(true);
    expect(getTestingWorkflow(workflow.id)).toBeNull();
  });
});
