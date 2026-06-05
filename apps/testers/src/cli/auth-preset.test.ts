import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { listScenarios } from "../db/scenarios.js";
import { listTestingWorkflows } from "../db/workflows.js";

const cleanupPaths: string[] = [];

function setupAuthPresetDb() {
  const baseDir = mkdtempSync(join(tmpdir(), "testers-auth-preset-"));
  const dbPath = join(baseDir, "testers.db");
  const testersDir = join(baseDir, ".hasna", "testers");
  cleanupPaths.push(baseDir);

  process.env.TESTERS_DB_PATH = dbPath;
  process.env.HASNA_TESTERS_DIR = testersDir;
  resetDatabase();
  const project = createProject({ name: "auth-project", scenarioPrefix: "AUT" });
  closeDatabase();

  return { dbPath, testersDir, project };
}

afterEach(() => {
  closeDatabase();
  for (const dir of cleanupPaths.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.TESTERS_DB_PATH;
  delete process.env.HASNA_TESTERS_DIR;
});

describe("testers auth preset CLI", () => {
  test("creates scenarios with env-backed auth config without storing raw secrets", () => {
    const { dbPath, testersDir, project } = setupAuthPresetDb();
    const env = {
      ...process.env,
      TESTERS_DB_PATH: dbPath,
      HASNA_TESTERS_DIR: testersDir,
      SMOKE_TEST_EMAIL: "admin@example.test",
      SMOKE_TEST_PASSWORD: "super-secret-password",
    };

    const authProc = spawnSync({
      cmd: [
        "bun",
        "run",
        "src/cli/index.tsx",
        "auth",
        "add",
        "alumia-smoke",
        "--email-env",
        "SMOKE_TEST_EMAIL",
        "--password-env",
        "SMOKE_TEST_PASSWORD",
        "--login-path",
        "/auth/login",
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(authProc.exitCode).toBe(0);
    expect(authProc.stdout.toString()).toContain("$SMOKE_TEST_EMAIL");
    expect(authProc.stdout.toString()).not.toContain("super-secret-password");

    const addProc = spawnSync({
      cmd: [
        "bun",
        "run",
        "src/cli/index.tsx",
        "add",
        "Authenticated smoke",
        "--project",
        project.id,
        "--path",
        "/test-org",
        "--auth-preset",
        "alumia-smoke",
        "--steps",
        "Open the authenticated dashboard",
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(addProc.exitCode).toBe(0);

    process.env.TESTERS_DB_PATH = dbPath;
    process.env.HASNA_TESTERS_DIR = testersDir;
    const scenario = listScenarios({ projectId: project.id })[0]!;
    expect(scenario.requiresAuth).toBe(true);
    expect(scenario.authConfig).toEqual({
      email: "$SMOKE_TEST_EMAIL",
      password: "$SMOKE_TEST_PASSWORD",
      loginPath: "/auth/login",
    });

    closeDatabase();
    const workflowProc = spawnSync({
      cmd: [
        "bun",
        "run",
        "src/cli/index.tsx",
        "workflow",
        "create",
        "Authenticated sandbox smoke",
        "--project",
        project.id,
        "--scenario",
        scenario.shortId ?? scenario.id,
        "--target",
        "sandbox",
        "--sandbox-provider",
        "e2b",
        "--sandbox-env",
        "SMOKE_TEST_EMAIL",
        "--sandbox-env",
        "SMOKE_TEST_PASSWORD",
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(workflowProc.exitCode).toBe(0);

    process.env.TESTERS_DB_PATH = dbPath;
    process.env.HASNA_TESTERS_DIR = testersDir;
    const workflow = listTestingWorkflows({ projectId: project.id })[0]!;
    expect(workflow.execution.env).toEqual({
      SMOKE_TEST_EMAIL: "$SMOKE_TEST_EMAIL",
      SMOKE_TEST_PASSWORD: "$SMOKE_TEST_PASSWORD",
    });
  });
});
