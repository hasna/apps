import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { closeDatabase, resetDatabase } from "../db/database.js";
import { createApiCheck } from "../db/api-checks.js";
import { createResult, updateResult } from "../db/results.js";
import { createRun } from "../db/runs.js";
import { createScenario } from "../db/scenarios.js";

const cleanupPaths: string[] = [];
const LONG_NAME_TAIL = "TAIL_VISIBLE_ONLY_IN_VERBOSE_OR_JSON";
const LONG_REASON_TAIL = "REASON_VISIBLE_ONLY_IN_VERBOSE";
const LONG_URL_TAIL = "URL_VISIBLE_ONLY_IN_VERBOSE";

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, "");
}

function setupDb() {
  const baseDir = mkdtempSync(join(tmpdir(), "testers-compact-cli-"));
  const dbPath = join(baseDir, "testers.db");
  cleanupPaths.push(baseDir);

  process.env.TESTERS_DB_PATH = dbPath;
  process.env.HASNA_TESTERS_DIR = baseDir;
  resetDatabase();

  const scenarios = Array.from({ length: 3 }, (_, index) =>
    createScenario({
      name: `Checkout ${index} ${"very ".repeat(30)}${LONG_NAME_TAIL}`,
      description: `Long description ${index}`,
      steps: ["Open cart", "Pay"],
      assertions: ["Receipt is visible"],
      tags: ["checkout", "regression", "signed-in", "stripe", "slow", "extra"],
    }),
  );

  const run = createRun({
    url: `https://example.test/${"deep/".repeat(25)}${LONG_URL_TAIL}`,
    model: "model-compact",
  });

  for (const scenario of scenarios) {
    const result = createResult({
      runId: run.id,
      scenarioId: scenario.id,
      model: "model-compact",
      stepsTotal: 2,
    });
    updateResult(result.id, {
      status: "failed",
      stepsCompleted: 1,
      reasoning: `The user could not complete checkout because ${"details ".repeat(40)}${LONG_REASON_TAIL}`,
      error: `Checkout error ${"stack ".repeat(40)}${LONG_REASON_TAIL}`,
    });
  }

  for (let index = 0; index < 3; index++) {
    createApiCheck({
      name: `API check ${index}`,
      url: `https://api.example.test/${index}`,
      tags: ["smoke"],
    });
  }

  closeDatabase();
  return { dbPath, baseDir, runId: run.id };
}

function runCli(dbPath: string, baseDir: string, args: string[]) {
  return spawnSync({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    env: {
      ...process.env,
      HASNA_TESTERS_DIR: baseDir,
      NO_COLOR: "1",
      TESTERS_DB_PATH: dbPath,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

afterEach(() => {
  closeDatabase();
  for (const dir of cleanupPaths.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.HASNA_TESTERS_DIR;
  delete process.env.TESTERS_DB_PATH;
});

describe("compact CLI output", () => {
  test("list defaults to compact human output with disclosure hints", () => {
    const { dbPath, baseDir } = setupDb();
    const proc = runCli(dbPath, baseDir, ["list", "--limit", "1"]);

    expect(proc.exitCode).toBe(0);
    const stdout = stripAnsi(proc.stdout.toString());
    expect(stdout).toContain("Scenarios");
    expect(stdout).toContain("Showing 1-1 of 3");
    expect(stdout).toContain("Compact output");
    expect(stdout).toContain("testers show <id>");
    expect(stdout).not.toContain(LONG_NAME_TAIL);
  });

  test("list --json preserves full machine-readable records", () => {
    const { dbPath, baseDir } = setupDb();
    const proc = runCli(dbPath, baseDir, ["list", "--limit", "1", "--json"]);

    expect(proc.exitCode).toBe(0);
    const records = JSON.parse(proc.stdout.toString());
    expect(records).toHaveLength(1);
    expect(records[0].name).toContain(LONG_NAME_TAIL);
    expect(records[0].tags).toContain("extra");
  });

  test("newly paged list commands preserve full JSON defaults", () => {
    const { dbPath, baseDir } = setupDb();
    const proc = runCli(dbPath, baseDir, ["api", "list", "--json"]);

    expect(proc.exitCode).toBe(0);
    const records = JSON.parse(proc.stdout.toString());
    expect(records).toHaveLength(3);
  });

  test("results defaults to paged compact output and verbose discloses full text", () => {
    const { dbPath, baseDir, runId } = setupDb();
    const compact = runCli(dbPath, baseDir, ["results", runId, "--limit", "1"]);

    expect(compact.exitCode).toBe(0);
    const compactStdout = stripAnsi(compact.stdout.toString());
    expect(compactStdout).toContain("Showing 1-1 of 3");
    expect(compactStdout).toContain("Compact output");
    expect(compactStdout).not.toContain(LONG_REASON_TAIL);
    expect(compactStdout).not.toContain(LONG_URL_TAIL);

    const verbose = runCli(dbPath, baseDir, ["results", runId, "--limit", "1", "--verbose"]);
    expect(verbose.exitCode).toBe(0);
    const verboseStdout = stripAnsi(verbose.stdout.toString());
    expect(verboseStdout).toContain(LONG_REASON_TAIL);
    expect(verboseStdout).toContain(LONG_URL_TAIL);
  });
});
