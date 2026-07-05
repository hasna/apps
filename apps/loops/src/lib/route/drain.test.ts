import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drainTodosTaskRoutes } from "./drain.js";

// Integration coverage for the freshness-close path: a route whose PR is
// definitively MERGED/CLOSED must not just skip (0.4.10 behavior, which left the
// task pending + auto:route and re-skipped it every tick) — the drain must close
// the source todos task so it leaves the queue. Uses a real temp `todos` project
// because the close pathway shells out to the todos CLI; skips cleanly when the
// binary is unavailable.

function todosAvailable(): boolean {
  try {
    return spawnSync("todos", ["--version"], { encoding: "utf8", timeout: 15_000 }).status === 0;
  } catch {
    return false;
  }
}

const HAS_TODOS = todosAvailable();

const BASE_OPTS = {
  tags: "auto:route",
  template: "task-lifecycle",
  provider: "codewith",
  sandbox: "workspace-write",
  worktreeMode: "auto",
  maxDispatch: "1",
} as const;

// Merge intent + baked-in MERGED state => the freshness gate fires from evidence
// text with no `gh` probe (hermetic, deterministic).
const MERGED_PR_DESCRIPTION = "please merge https://github.com/hasna/example/pull/7 pr_state=MERGED";

describe("drainTodosTaskRoutes freshness close", () => {
  let todosProject: string;
  let dataDir: string;
  let oldDataDir: string | undefined;

  beforeEach(() => {
    todosProject = mkdtempSync(join(tmpdir(), "loops-drain-src-"));
    dataDir = mkdtempSync(join(tmpdir(), "loops-drain-data-"));
    oldDataDir = process.env.LOOPS_DATA_DIR;
    process.env.LOOPS_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (oldDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
    else process.env.LOOPS_DATA_DIR = oldDataDir;
    rmSync(todosProject, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  function addTask(description: string, tags = "auto:route"): string {
    const result = spawnSync(
      "todos",
      ["--project", todosProject, "--json", "add", "Merge the release PR", "-d", description, "-t", tags],
      { encoding: "utf8", timeout: 30_000 },
    );
    if (result.status !== 0) throw new Error(`todos add failed: ${result.stderr}`);
    return JSON.parse(result.stdout).id as string;
  }

  function taskState(id: string): { status: string; tags: string[] } {
    const result = spawnSync("todos", ["--project", todosProject, "--json", "show", id], { encoding: "utf8", timeout: 30_000 });
    const task = JSON.parse(result.stdout);
    return { status: task.status, tags: task.tags ?? [] };
  }

  function readyCount(): number {
    const result = spawnSync("todos", ["--project", todosProject, "--json", "ready", "--limit", "20"], { encoding: "utf8", timeout: 30_000 });
    return (JSON.parse(result.stdout || "[]") as unknown[]).length;
  }

  test.skipIf(!HAS_TODOS)("closes a merged-PR task out of the queue instead of re-skipping it", () => {
    const taskId = addTask(MERGED_PR_DESCRIPTION);
    expect(readyCount()).toBe(1);

    const result = drainTodosTaskRoutes({ ...BASE_OPTS, todosProject });

    expect(result.value.created).toBe(0);
    expect(result.value.freshnessClosed).toBe(1);
    const r0 = (result.value.results as Array<Record<string, unknown>>)[0]!;
    expect(r0.kind).toBe("skipped");
    expect(r0.freshnessSkip).toBe(true);
    expect(r0.prState).toBe("MERGED");
    expect((r0.sourceTaskUpdate as { action?: string }).action).toBe("freshness-close");

    // Regression: the task left the routable queue — marked done and untagged.
    const after = taskState(taskId);
    expect(after.status).toBe("completed");
    expect(after.tags).not.toContain("auto:route");
    expect(readyCount()).toBe(0);
  }, 15_000);

  test.skipIf(!HAS_TODOS)("dry-run never mutates the source task", () => {
    const taskId = addTask(MERGED_PR_DESCRIPTION);

    const result = drainTodosTaskRoutes({ ...BASE_OPTS, todosProject, dryRun: true });

    expect(result.value.freshnessClosed).toBe(0);
    const after = taskState(taskId);
    expect(after.status).toBe("pending");
    expect(after.tags).toContain("auto:route");
    expect(readyCount()).toBe(1);
  }, 15_000);
});
