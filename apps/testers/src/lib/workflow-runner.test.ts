process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTestingWorkflow } from "../db/workflows.js";
import { buildWorkflowRunPlan, runTestingWorkflow } from "./workflow-runner.js";

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

    expect(plan.sandbox).toBeNull();
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

  test("builds a sandboxes SDK command plan for sandbox workflows", () => {
    const workflow = createTestingWorkflow({
      name: "sandbox",
      scenarioFilter: { scenarioIds: ["S1", "S2"] },
      execution: {
        target: "sandbox",
        provider: "e2b",
        sandboxImage: "bun-playwright",
        sandboxRemoteDir: "/workspace/testers",
        sandboxCleanup: "stop",
      },
    });

    const plan = buildWorkflowRunPlan(workflow, { url: "https://preview.example", model: "quick" });

    expect(plan.sandbox).toMatchObject({
      provider: "e2b",
      image: "bun-playwright",
      remoteDir: "/workspace/testers",
      stateRemoteDir: "/workspace/testers/.testers-state",
      cleanup: "stop",
      syncStrategy: "rsync",
    });
    expect(plan.sandbox?.command).toContain("HASNA_TESTERS_DB_PATH=");
    expect(plan.sandbox?.command).toContain("bunx");
    expect(plan.sandbox?.command).toContain("@hasna/testers");
    expect(plan.sandbox?.command).toContain("--scenario");
    expect(plan.sandbox?.command).toContain("S1,S2");
  });

  test("runs sandbox workflows through the sandboxes SDK with a portable DB bundle", async () => {
    const workflow = createTestingWorkflow({
      name: "sandbox",
      scenarioFilter: { tags: ["checkout"] },
      execution: {
        target: "sandbox",
        provider: "daytona",
        sandboxImage: "node-bun-playwright",
        sandboxRemoteDir: "/workspace/testers",
        sandboxCleanup: "delete",
        timeoutMs: 120000,
        env: { APP_ENV: "preview" },
      },
    });
    const calls: unknown[] = [];
    const output = await runTestingWorkflow(workflow.id, {
      url: "https://preview.example",
      model: "quick",
    }, {
      createDatabaseBundle: () => ({
        localDir: "/tmp/testers-db",
        remoteDir: "/workspace/testers/.testers-state",
        cleanup: () => calls.push({ cleanup: true }),
      }),
      sandboxes: {
        async runCommandInSandbox(input) {
          calls.push(input);
          return {
            sandbox: { id: "sb_123", provider: "daytona" },
            session: { id: "sess_123" },
            result: {
              exit_code: 0,
              stdout: "{\"run\":{\"id\":\"remote\"},\"results\":[]}",
              stderr: "",
            },
            cleanup: "deleted",
          };
        },
      },
    });

    expect(output.run).toBeNull();
    expect(output.results).toEqual([]);
    expect(output.sandboxResult).toMatchObject({
      sandboxId: "sb_123",
      sessionId: "sess_123",
      exitCode: 0,
      stdout: "{\"run\":{\"id\":\"remote\"},\"results\":[]}",
      cleanup: "deleted",
    });
    expect(calls[0]).toMatchObject({
      provider: "daytona",
      image: "node-bun-playwright",
      sandboxTimeout: 120000,
      commandTimeoutMs: 120000,
      sandboxEnvVars: { APP_ENV: "preview" },
      cleanup: "delete",
      upload: {
        localDir: "/tmp/testers-db",
        remoteDir: "/workspace/testers/.testers-state",
        syncStrategy: "rsync",
      },
    });
    expect(calls[0]).toHaveProperty("command");
    expect(calls[1]).toEqual({ cleanup: true });
  });
});
