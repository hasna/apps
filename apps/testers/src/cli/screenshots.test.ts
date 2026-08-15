import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "bun";

import { createRun } from "../db/runs.js";
import { createScenario } from "../db/scenarios.js";
import { createResult } from "../db/results.js";
import { createScreenshot } from "../db/screenshots.js";
import { closeDatabase, resetDatabase } from "../db/database.js";

const cleanupPaths: string[] = [];

function setupSeededDb() {
  const baseDir = mkdtempSync(join(tmpdir(), "testers-cli-"));
  const dbPath = join(baseDir, "testers.db");
  cleanupPaths.push(baseDir);

  process.env.TESTERS_DB_PATH = dbPath;
  resetDatabase();

  const scenario = createScenario({ name: "CLI screenshots", description: "seed" });
  const run = createRun({ url: "https://example.com", model: "quick" });
  const result = createResult({ runId: run.id, scenarioId: scenario.id, model: "quick", stepsTotal: 2 });

  createScreenshot({ resultId: result.id, stepNumber: 1, action: "open", filePath: "/tmp/1.png", width: 100, height: 100 });
  createScreenshot({ resultId: result.id, stepNumber: 2, action: "click", filePath: "/tmp/2.png", width: 100, height: 100 });

  closeDatabase();
  return { dbPath, runId: run.id, resultId: result.id };
}

afterEach(() => {
  closeDatabase();
  for (const dir of cleanupPaths.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.TESTERS_DB_PATH;
});

describe("testers screenshots CLI", () => {
  test("supports --json --limit --offset for run IDs", () => {
    const { dbPath, runId } = setupSeededDb();
    const proc = spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "screenshots", runId, "--json", "--limit", "1", "--offset", "1"],
      env: { ...process.env, TESTERS_DB_PATH: dbPath },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    const output = JSON.parse(proc.stdout.toString());
    expect(output.type).toBe("run");
    expect(output.total).toBe(2);
    expect(output.limit).toBe(1);
    expect(output.offset).toBe(1);
    expect(output.items).toHaveLength(1);
    expect(output.items[0].stepNumber).toBe(2);
  });

  test("supports --json for result IDs", () => {
    const { dbPath, resultId } = setupSeededDb();
    const proc = spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "screenshots", resultId, "--json"],
      env: { ...process.env, TESTERS_DB_PATH: dbPath },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    const output = JSON.parse(proc.stdout.toString());
    expect(output.type).toBe("result");
    expect(output.total).toBe(2);
    expect(output.items).toHaveLength(2);
  });
});
