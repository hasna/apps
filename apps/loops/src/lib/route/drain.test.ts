import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { dbPath } from "../paths.js";
import { drainTodosTaskRoutes } from "./drain.js";

// Integration coverage for the freshness-close path: a route whose PR is
// definitively MERGED/CLOSED must not just skip (0.4.10 behavior, which left the
// task pending + auto:route and re-skipped it every tick) — the drain must close
// the source todos task so it leaves the queue. Uses a real temp `todos` project
// because the close pathway shells out to the todos CLI; skips cleanly when the
// binary is unavailable.

function todosAvailable(): boolean {
  let todosProject: string | undefined;
  let taskId: string | undefined;
  try {
    if (spawnSync("todos", ["--version"], { encoding: "utf8", timeout: 15_000 }).status !== 0) return false;
    todosProject = mkdtempSync(join(tmpdir(), "loops-drain-probe-"));
    const taskListId = `todos-${basename(todosProject).toLowerCase()}`;
    const registered = spawnSync(
      "todos",
      ["projects", "--add", todosProject, "--name", basename(todosProject), "--task-list-id", taskListId],
      { encoding: "utf8", timeout: 30_000 },
    );
    if (registered.status !== 0) return false;
    const added = spawnSync(
      "todos",
      ["--project", todosProject, "--json", "add", "OpenLoops ready probe", "-d", "probe", "-t", "auto:route", "--list", taskListId],
      { encoding: "utf8", timeout: 30_000 },
    );
    if (added.status !== 0) return false;
    taskId = JSON.parse(added.stdout).id as string;
    const ready = spawnSync("todos", ["--project", todosProject, "--json", "ready", "--limit", "20"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    if (ready.status !== 0) return false;
    return (JSON.parse(ready.stdout || "[]") as Array<{ id?: string }>).some((task) => task.id === taskId);
  } catch {
    return false;
  } finally {
    if (taskId) spawnSync("todos", ["delete", taskId], { encoding: "utf8", timeout: 30_000 });
    if (todosProject) {
      spawnSync("todos", ["projects", "--deregister", todosProject, "--path-prefix", tmpdir()], { encoding: "utf8", timeout: 30_000 });
      rmSync(todosProject, { recursive: true, force: true });
    }
  }
}

const HAS_TODOS = todosAvailable();
const TODOS_INTEGRATION_TIMEOUT_MS = 15_000;

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
  let taskListId: string;
  let dataDir: string;
  let oldDataDir: string | undefined;
  let createdTaskIds: string[];

  beforeEach(() => {
    todosProject = mkdtempSync(join(tmpdir(), "loops-drain-src-"));
    taskListId = `todos-${basename(todosProject).toLowerCase()}`;
    const registered = spawnSync(
      "todos",
      ["projects", "--add", todosProject, "--name", basename(todosProject), "--task-list-id", taskListId],
      { encoding: "utf8", timeout: 30_000 },
    );
    if (registered.status !== 0) throw new Error(`todos project registration failed: ${registered.stderr}`);
    dataDir = mkdtempSync(join(tmpdir(), "loops-drain-data-"));
    oldDataDir = process.env.LOOPS_DATA_DIR;
    process.env.LOOPS_DATA_DIR = dataDir;
    createdTaskIds = [];
  });

  afterEach(() => {
    if (oldDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
    else process.env.LOOPS_DATA_DIR = oldDataDir;
    for (const taskId of createdTaskIds) {
      spawnSync("todos", ["delete", taskId], { encoding: "utf8", timeout: 30_000 });
    }
    spawnSync("todos", ["projects", "--deregister", todosProject, "--path-prefix", tmpdir()], { encoding: "utf8", timeout: 30_000 });
    rmSync(todosProject, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  function addTask(description: string, tags = "auto:route"): string {
    const result = spawnSync(
      "todos",
      ["--project", todosProject, "--json", "add", "Merge the release PR", "-d", description, "-t", tags, "--list", taskListId],
      { encoding: "utf8", timeout: 30_000 },
    );
    if (result.status !== 0) throw new Error(`todos add failed: ${result.stderr}`);
    const id = JSON.parse(result.stdout).id as string;
    createdTaskIds.push(id);
    return id;
  }

  function taskState(id: string): { status: string; tags: string[] } {
    const result = spawnSync("todos", ["--project", todosProject, "--json", "show", id], { encoding: "utf8", timeout: 30_000 });
    const task = JSON.parse(result.stdout);
    return { status: task.status, tags: task.tags ?? [] };
  }

  function completeTask(id: string): void {
    const result = spawnSync(
      "todos",
      ["--project", todosProject, "done", id, "--notes", "launch gate blocker resolved for test"],
      { encoding: "utf8", timeout: 30_000 },
    );
    if (result.status !== 0) throw new Error(`todos done failed: ${result.stderr}`);
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
  }, TODOS_INTEGRATION_TIMEOUT_MS);

  test.skipIf(!HAS_TODOS)("dry-run never mutates the source task", () => {
    const taskId = addTask(MERGED_PR_DESCRIPTION);

    const result = drainTodosTaskRoutes({ ...BASE_OPTS, todosProject, dryRun: true });

    expect(result.value.freshnessClosed).toBe(0);
    const after = taskState(taskId);
    expect(after.status).toBe("pending");
    expect(after.tags).toContain("auto:route");
    expect(readyCount()).toBe(1);
  }, TODOS_INTEGRATION_TIMEOUT_MS);

  test.skipIf(!HAS_TODOS)("launch gate blocks a drain before route work is created", () => {
    const blockerId = addTask("PA-19 blocker remains open", "controlled-launch");
    const candidateId = addTask("Route candidate that must wait for the launch gate");

    const result = drainTodosTaskRoutes({
      ...BASE_OPTS,
      todosProject,
      launchGate: "pa19-controlled-launch",
      launchGateBlocker: [`${todosProject}::${blockerId}`],
    });

    expect(result.value.created).toBe(0);
    expect(result.value.blocked).toBe(1);
    expect(result.value.considered).toBe(0);
    expect(result.value.scanned).toBe(0);
    expect(existsSync(join(dataDir, "loops.db"))).toBe(false);
    const gate = result.value.launchGate as { blocked?: boolean; blockers?: Array<{ taskId?: string; status?: string; resolved?: boolean }> };
    expect(gate.blocked).toBe(true);
    expect(gate.blockers?.[0]).toMatchObject({ taskId: blockerId, status: "pending", resolved: false });

    expect(taskState(blockerId).status).toBe("pending");
    const candidate = taskState(candidateId);
    expect(candidate.status).toBe("pending");
    expect(candidate.tags).toContain("auto:route");
  }, TODOS_INTEGRATION_TIMEOUT_MS);

  test.skipIf(!HAS_TODOS)("launch gate dry-run is non-mutating", () => {
    const blockerId = addTask("PA-19 blocker remains open", "controlled-launch");
    const candidateId = addTask("Route candidate that must wait for the launch gate");

    const result = drainTodosTaskRoutes({
      ...BASE_OPTS,
      todosProject,
      dryRun: true,
      launchGate: "pa19-controlled-launch",
      launchGateBlocker: [`${todosProject}::${blockerId}`],
    });

    expect(result.value.created).toBe(0);
    expect(result.value.blocked).toBe(1);
    expect(result.value.dryRun).toBe(true);
    expect(taskState(blockerId).status).toBe("pending");
    const candidate = taskState(candidateId);
    expect(candidate.status).toBe("pending");
    expect(candidate.tags).toContain("auto:route");
  }, TODOS_INTEGRATION_TIMEOUT_MS);

  test.skipIf(!HAS_TODOS)("launch gate opens when blockers are completed", () => {
    const blockerId = addTask("PA-19 blocker resolved", "controlled-launch");
    completeTask(blockerId);
    const candidateId = addTask("Route candidate that may run once the launch gate opens");

    const result = drainTodosTaskRoutes({
      ...BASE_OPTS,
      todosProject,
      dryRun: true,
      launchGate: "pa19-controlled-launch",
      launchGateBlocker: [`${todosProject}::${blockerId}`],
    });

    expect(result.value.created).toBe(1);
    expect(result.value.blocked).toBe(0);
    expect(result.value.considered).toBe(1);
    const gate = result.value.launchGate as { blocked?: boolean; blockers?: Array<{ taskId?: string; status?: string; resolved?: boolean }> };
    expect(gate.blocked).toBe(false);
    expect(gate.blockers?.[0]).toMatchObject({ taskId: blockerId, status: "completed", resolved: true });
    const routed = (result.value.results as Array<Record<string, unknown>>)[0]!;
    expect(routed.kind).toBe("created");
    expect(taskState(candidateId).status).toBe("pending");
  }, TODOS_INTEGRATION_TIMEOUT_MS);

  test.skipIf(!HAS_TODOS)("holds route-disallowed tasks out of the candidate window", () => {
    // A no-auto task can never route; before the fix it occupied one of the
    // bounded candidate rows every tick (rejected by eligibility only AFTER
    // taking the slot), so enough marked tasks starved the window forever.
    const markedId = addTask("Marked non-routeable earlier", "auto:route,no-auto");
    const routableId = addTask(MERGED_PR_DESCRIPTION);
    expect(readyCount()).toBe(2);

    const result = drainTodosTaskRoutes({ ...BASE_OPTS, todosProject });

    // The no-auto task is excluded BEFORE the candidate slice (counted), so the
    // routable task gets the window; no slot burns on an eligibility skip.
    expect(result.value.excludedDisallowedTag).toBe(1);
    expect(result.value.candidates).toBe(1);
    expect(result.value.considered).toBe(1);
    expect(result.human).toContain("excludedDisallowedTag=1");
    const ids = (result.value.results as Array<Record<string, unknown>>).map((entry) => entry.taskId);
    expect(ids).toEqual([routableId]);
    expect(ids).not.toContain(markedId);

    // The excluded task is untouched at the source (the memory only affects the window).
    expect(taskState(markedId).status).toBe("pending");
    expect(taskState(markedId).tags).toContain("no-auto");
  }, TODOS_INTEGRATION_TIMEOUT_MS);

  test.skipIf(!HAS_TODOS)("reports a redispatch-cap dead-letter instead of a silent created=0", () => {
    const taskId = addTask("Worker keeps finishing without closing this task");
    // First drain admits the work item (attempts=1).
    const first = drainTodosTaskRoutes({ ...BASE_OPTS, todosProject });
    expect(first.value.created).toBe(1);
    expect(first.value.deadLettered).toBe(0);

    // Simulate 8 prior runs that finished terminal without closing the task,
    // backdated past the backoff window — the redispatch cap is now reached.
    const db = new Database(dbPath());
    try {
      const backdated = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
      db.query("UPDATE workflow_work_items SET status='failed', attempts=8, updated_at=? WHERE route_key='todos-task'").run(backdated);
    } finally {
      db.close();
    }

    // Next drain: no new dispatch, but the cap is now VISIBLE (not a silent hole).
    const second = drainTodosTaskRoutes({ ...BASE_OPTS, todosProject });
    expect(second.value.created).toBe(0);
    expect(second.value.deduped).toBe(1);
    expect(second.value.deadLettered).toBe(1);
    expect(second.human).toContain("deadLettered=1");
    const dl = (second.value.results as Array<Record<string, unknown>>)[0]!;
    expect(dl.kind).toBe("deduped");
    expect(dl.deadLettered).toBe(true);

    // The task is still actionable (pending), but its work item is now dead_letter.
    expect(taskState(taskId).status).toBe("pending");
    const after = new Database(dbPath());
    try {
      const row = after.query<{ status: string }, []>("SELECT status FROM workflow_work_items WHERE route_key='todos-task' LIMIT 1").get();
      expect(row?.status).toBe("dead_letter");
    } finally {
      after.close();
    }
  }, TODOS_INTEGRATION_TIMEOUT_MS);
});
