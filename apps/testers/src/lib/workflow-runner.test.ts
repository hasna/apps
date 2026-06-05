process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTestingWorkflow } from "../db/workflows.js";
import { buildWorkflowRunPlan, createWorkflowDatabaseBundle, runTestingWorkflow } from "./workflow-runner.js";

const cleanupPaths: string[] = [];

describe("workflow runner", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
    for (const dir of cleanupPaths.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
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
    const originalSmokePassword = process.env.SMOKE_TEST_PASSWORD;
    const originalOpenAIKey = process.env.OPENAI_API_KEY;
    process.env.SMOKE_TEST_PASSWORD = "sandbox-secret";
    delete process.env.OPENAI_API_KEY;
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
        env: {
          APP_ENV: "preview",
          SMOKE_TEST_PASSWORD: "$SMOKE_TEST_PASSWORD",
          OPENAI_API_KEY: "$?OPENAI_API_KEY",
        },
      },
    });
    const calls: unknown[] = [];
    try {
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
        sandboxEnvVars: { APP_ENV: "preview", SMOKE_TEST_PASSWORD: "sandbox-secret" },
        cleanup: "delete",
        upload: {
          localDir: "/tmp/testers-db",
          remoteDir: "/workspace/testers/.testers-state",
          syncStrategy: "rsync",
        },
      });
      expect(calls[0]).toHaveProperty("command");
      expect(calls[1]).toEqual({ cleanup: true });
    } finally {
      if (originalSmokePassword === undefined) delete process.env.SMOKE_TEST_PASSWORD;
      else process.env.SMOKE_TEST_PASSWORD = originalSmokePassword;
      if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
  });

  test("builds and bundles app source for sandbox workflows that start the app", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "testers-app-source-"));
    cleanupPaths.push(sourceDir);
    writeFileSync(join(sourceDir, "package.json"), JSON.stringify({ scripts: { dev: "next dev" } }));
    writeFileSync(join(sourceDir, ".env.local"), "SECRET_SHOULD_NOT_UPLOAD=1\n");
    mkdirSync(join(sourceDir, "src"), { recursive: true });
    writeFileSync(join(sourceDir, "src", "index.ts"), "export const ok = true;\n");
    mkdirSync(join(sourceDir, "node_modules", "skip"), { recursive: true });
    writeFileSync(join(sourceDir, "node_modules", "skip", "index.js"), "module.exports = {};\n");

    const workflow = createTestingWorkflow({
      name: "sandbox app",
      scenarioFilter: { scenarioIds: ["APP-1"] },
      execution: {
        target: "sandbox",
        provider: "e2b",
        sandboxRemoteDir: "/workspace/testers",
        sandboxSyncStrategy: "rsync",
        appSourceDir: sourceDir,
        appStartCommand: "bun run dev --host 0.0.0.0",
        appUrl: "http://127.0.0.1:3325",
        appWaitTimeoutMs: 45000,
      },
    });

    const plan = buildWorkflowRunPlan(workflow, { url: "https://ignored.example" });
    expect(plan.sandbox).toMatchObject({
      remoteDir: "/workspace/testers",
      stateRemoteDir: "/workspace/testers/.testers-state",
      appSourceDir: sourceDir,
      appRemoteDir: "/workspace/testers/app",
      appStartCommand: "bun run dev --host 0.0.0.0",
      appUrl: "http://127.0.0.1:3325",
      appWaitTimeoutMs: 45000,
    });
    expect(plan.sandbox?.command).toContain("cd '/workspace/testers/app'");
    expect(plan.sandbox?.command).toContain("( bun run dev --host 0.0.0.0 )");
    expect(plan.sandbox?.command).toContain("'run' 'http://127.0.0.1:3325'");
    expect(plan.sandbox?.command).toContain("Timed out waiting for");

    const bundle = createWorkflowDatabaseBundle(workflow, plan);
    cleanupPaths.push(bundle.localDir);
    expect(bundle.remoteDir).toBe("/workspace/testers");
    expect(existsSync(join(bundle.localDir, ".testers-state", "testers.db"))).toBe(true);
    expect(readFileSync(join(bundle.localDir, "app", "src", "index.ts"), "utf8")).toContain("ok = true");
    expect(existsSync(join(bundle.localDir, "app", ".env.local"))).toBe(false);
    expect(existsSync(join(bundle.localDir, "app", "node_modules"))).toBe(false);
  });
});
