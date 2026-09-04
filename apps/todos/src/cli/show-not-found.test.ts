import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

const CWD = join(import.meta.dir, "../..");
const MISSING_TASK_ID = "00000000-0000-4000-8000-000000000404";
const TIMEOUT = 30_000;

let root: string;
let dbPath: string;

type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

async function runCli(args: string[]): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: CWD,
    env: localRoutingTestEnv({
      HOME: join(root, "home"),
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "todos-show-not-found-"));
  dbPath = join(root, "todos.db");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("todos show missing-task contract", () => {
  test("JSON returns the structured not-found contract instead of dereferencing null", async () => {
    const result = await runCli(["--json", "show", MISSING_TASK_ID]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      error: `Task not found: ${MISSING_TASK_ID}`,
    });
    expect(result.stderr).toContain(`Task not found: ${MISSING_TASK_ID}`);
    expect(result.stderr).not.toContain("git_refs");
    expect(result.stderr).not.toContain("null is not an object");
  }, TIMEOUT);

  test("human output reports not found instead of dereferencing null", async () => {
    const result = await runCli(["show", MISSING_TASK_ID]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`Task not found: ${MISSING_TASK_ID}`);
    expect(result.stderr).not.toContain("git_refs");
    expect(result.stderr).not.toContain("null is not an object");
  }, TIMEOUT);

  test("positive control: a found task still renders on JSON and human surfaces", async () => {
    const created = await runCli(["--json", "add", "show found-task control"]);
    expect(created.exitCode).toBe(0);
    const task = JSON.parse(created.stdout) as { id: string };

    const json = await runCli(["--json", "show", task.id]);
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({
      id: task.id,
      title: "show found-task control",
      git_refs: [],
    });

    const human = await runCli(["show", task.id]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("Task Details:");
    expect(human.stdout).toContain("show found-task control");
    // Explicit-opt-in local runs emit no fallback notice (fail-closed ruling, hasna/apps#1613).
    expect(human.stderr).not.toContain('"event":"todos-local-fallback"');
  }, TIMEOUT);
});
