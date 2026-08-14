import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, resetDatabase } from "../db/database.js";
import { createTestingWorkflow } from "../db/workflows.js";

const cleanupPaths: string[] = [];

function setupFanoutDb(workflowCount = 1) {
  const baseDir = mkdtempSync(join(tmpdir(), "testers-workflow-fanout-output-"));
  const dbPath = join(baseDir, "testers.db");
  cleanupPaths.push(baseDir);

  process.env.TESTERS_DB_PATH = dbPath;
  resetDatabase();

  const workflows = Array.from({ length: workflowCount }, (_, index) => createTestingWorkflow({
    name: `artifact workflow ${index + 1}`,
    scenarioFilter: { tags: [`artifact-${index + 1}`] },
    execution: {
      target: "sandbox",
      provider: "e2b",
      env: { ANTHROPIC_API_KEY: "$?ANTHROPIC_API_KEY" },
    },
  }));

  closeDatabase();
  delete process.env.TESTERS_DB_PATH;

  return { baseDir, dbPath, workflows };
}

afterEach(() => {
  closeDatabase();
  delete process.env.TESTERS_DB_PATH;
  for (const dir of cleanupPaths.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("testers workflow fanout --output", () => {
  test("writes single-batch fanout JSON evidence to a file", () => {
    const { baseDir, dbPath, workflows } = setupFanoutDb();
    const outputPath = join(baseDir, "artifacts", "fanout.json");
    const proc = spawnSync({
      cmd: [
        "bun",
        "run",
        "src/cli/index.tsx",
        "workflow",
        "fanout",
        workflows[0]!.id,
        "--url",
        "https://app.example.test",
        "--dry-run",
        "--output",
        outputPath,
      ],
      env: {
        ...process.env,
        TESTERS_DB_PATH: dbPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    const result = JSON.parse(readFileSync(outputPath, "utf-8")) as {
      status: string;
      total: number;
      items: Array<{ workflowName: string; status: string }>;
    };
    expect(result.status).toBe("dry-run");
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      workflowName: "artifact workflow 1",
      status: "dry-run",
    });
  });

  test("writes multi-batch fanout JSON evidence to a file", () => {
    const { baseDir, dbPath } = setupFanoutDb(2);
    const outputPath = join(baseDir, "artifacts", "fanout-batches.json");
    const proc = spawnSync({
      cmd: [
        "bun",
        "run",
        "src/cli/index.tsx",
        "workflow",
        "fanout",
        "--url",
        "https://app.example.test",
        "--all-batches",
        "--batch-size",
        "1",
        "--dry-run",
        "--output",
        outputPath,
      ],
      env: {
        ...process.env,
        TESTERS_DB_PATH: dbPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    const result = JSON.parse(readFileSync(outputPath, "utf-8")) as {
      status: string;
      total: number;
      totalBatches: number;
      batches: Array<{ total: number; status: string }>;
    };
    expect(result.status).toBe("dry-run");
    expect(result.total).toBe(2);
    expect(result.totalBatches).toBe(2);
    expect(result.batches).toHaveLength(2);
    expect(result.batches.every((batch) => batch.status === "dry-run" && batch.total === 1)).toBe(true);
  });
});
