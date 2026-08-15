import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createScenario } from "../db/scenarios.js";

const cleanupPaths: string[] = [];

function setupDryRunDb() {
  const baseDir = mkdtempSync(join(tmpdir(), "testers-run-dry-run-"));
  const dbPath = join(baseDir, "testers.db");
  const testersDir = join(baseDir, ".hasna", "testers");
  cleanupPaths.push(baseDir);

  process.env.TESTERS_DB_PATH = dbPath;
  process.env.HASNA_TESTERS_DIR = testersDir;
  resetDatabase();

  const project = createProject({ name: "dry-run-project", scenarioPrefix: "DRY" });
  const scenario = createScenario({
    name: "Structured assertion smoke",
    description: "Dry-run should accept already parsed assertions",
    projectId: project.id,
    assertions: [{ type: "no_console_errors", description: "No console errors" }],
  });

  closeDatabase();
  return { dbPath, testersDir, project, scenario };
}

afterEach(() => {
  closeDatabase();
  for (const dir of cleanupPaths.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.TESTERS_DB_PATH;
  delete process.env.HASNA_TESTERS_DIR;
});

describe("testers run dry-run CLI", () => {
  test("accepts structured assertions stored on scenarios", () => {
    const { dbPath, testersDir, project, scenario } = setupDryRunDb();
    const proc = spawnSync({
      cmd: [
        "bun",
        "run",
        "src/cli/index.tsx",
        "--no-color",
        "run",
        "http://127.0.0.1:3325",
        "--project",
        project.id,
        "--scenario",
        scenario.shortId,
        "--dry-run",
        "--no-auto-generate",
      ],
      env: { ...process.env, TESTERS_DB_PATH: dbPath, HASNA_TESTERS_DIR: testersDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    const stdout = proc.stdout.toString();
    expect(stdout).toContain(`${scenario.shortId} Structured assertion smoke`);
    expect(stdout).not.toContain("Invalid assertions");
  });
});
