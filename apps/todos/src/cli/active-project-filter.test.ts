import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

const REPO_ROOT = join(import.meta.dir, "../..");
const tempRoots: string[] = [];

type CliResult = { exitCode: number; stdout: string; stderr: string };

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "todos-active-project-filter-"));
  tempRoots.push(root);
  return root;
}

async function runCli(args: string[], dbPath: string, home: string): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: localRoutingTestEnv({
      HOME: home,
      TMPDIR: home,
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

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("active project filters", () => {
  test("rejects an explicitly empty project filter instead of returning unfiltered work", async () => {
    const home = tempRoot();
    const dbPath = join(home, "todos.db");

    const project = await runCli(
      ["--json", "projects", "--add", join(home, "active-project"), "--name", "Active Project"],
      dbPath,
      home,
    );
    expect(project.exitCode).toBe(0);
    const projectId = (JSON.parse(project.stdout) as { id: string }).id;

    const task = await runCli(
      ["--json", "add", "Active task", "--status", "in_progress", "--project", projectId, "--unassigned"],
      dbPath,
      home,
    );
    expect(task.exitCode).toBe(0);

    const result = await runCli(["--json", "active", "--project", ""], dbPath, home);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/--project requires a non-empty/i);
    expect(result.stdout).not.toContain("Active task");
  });

  test("returns an empty JSON list for a valid project with no active tasks", async () => {
    const home = tempRoot();
    const dbPath = join(home, "todos.db");

    const project = await runCli(
      ["--json", "projects", "--add", join(home, "empty-project"), "--name", "Empty Project"],
      dbPath,
      home,
    );
    expect(project.exitCode).toBe(0);
    const projectId = (JSON.parse(project.stdout) as { id: string }).id;

    const result = await runCli(["--json", "active", "--project", projectId], dbPath, home);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
  });

  test("returns only active tasks for a valid non-empty project", async () => {
    const home = tempRoot();
    const dbPath = join(home, "todos.db");

    const project = await runCli(
      ["--json", "projects", "--add", join(home, "active-project"), "--name", "Active Project"],
      dbPath,
      home,
    );
    expect(project.exitCode).toBe(0);
    const projectId = (JSON.parse(project.stdout) as { id: string }).id;

    const active = await runCli(
      ["--json", "add", "Active task", "--status", "in_progress", "--project", projectId, "--unassigned"],
      dbPath,
      home,
    );
    expect(active.exitCode).toBe(0);
    const activeTaskId = (JSON.parse(active.stdout) as { id: string }).id;

    const result = await runCli(["--json", "active", "--project", projectId], dbPath, home);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as Array<{ id: string }>).map((task) => task.id)).toEqual([activeTaskId]);
  });

  test("reports an unsupported format option instead of exiting silently", async () => {
    const home = tempRoot();
    const dbPath = join(home, "todos.db");

    const result = await runCli(["active", "--format", "json"], dbPath, home);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.trim()).not.toBe("");
    expect(result.stderr).toMatch(/unknown option|--format.*not supported/i);
  });

  test("reports the full unsupported project-name and format invocation instead of exiting silently", async () => {
    const home = tempRoot();
    const dbPath = join(home, "todos.db");

    const result = await runCli(
      ["active", "--project-name", "agent-chief-research", "--format", "json"],
      dbPath,
      home,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.trim()).not.toBe("");
    expect(result.stderr).toMatch(/unknown option|unsupported.*--format|--format.*not supported/i);
  });
});
