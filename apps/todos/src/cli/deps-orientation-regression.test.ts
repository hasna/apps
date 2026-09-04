import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, addDependency, completeTask, updateTask, getTaskWithRelations } from "../db/tasks.js";
import { getTaskDependencyEdges, buildTaskDependencyEdges } from "../lib/dependency-graph.js";
import type { Task } from "../types/index.js";
import { deliverTodosApiKeyViaDisk } from "../testing.js";

/**
 * REGRESSION — inverted dependency semantics in the machine-readable reads
 * (todos task 4599ef37, measured 2026-07-28 on a real production pair).
 *
 * `todos deps <id> --json` used to put the BLOCKS edge (this task's
 * DEPENDENTS) inside the field named `blocked_by`, so automation consuming the
 * field BY NAME gated the wrong side: @hasnaxyz/factory refused to dispatch
 * the upstream task of every dependency chain with `dependency_unmet` — the
 * chain deadlocked its own blocker, and the dependent could never become
 * runnable either. The human `Depends on:`/`Blocks:` output was correct; only
 * the JSON field naming was inverted.
 *
 * Contract locked in here (names mean what they say):
 *   - `dependencies` = ALL prerequisites (upstream; what I depend on)
 *   - `blocked_by`   = the prerequisites that are INCOMPLETE — the tasks that
 *                      block me RIGHT NOW (completed/cancelled deps do not
 *                      block; matches getBlockedTasks/getBlockingDeps)
 *   - `blocks`       = my dependents (downstream; the tasks I block)
 * A blocker with no prerequisites reports `blocked_by: []` and is dispatchable;
 * its dependent reports `dependencies: [blocker]` and `blocked_by: [blocker]`
 * until the blocker completes, then `blocked_by: []`.
 */

// ── Library level (local sqlite) ────────────────────────────────────────────

describe("dependency orientation regression (library)", () => {
  beforeEach(() => {
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    getDatabase();
  });

  afterEach(() => {
    closeDatabase();
    delete process.env["TODOS_DB_PATH"];
  });

  test("getTaskDependencyEdges: the blocker is unblocked, the dependent is blocked — never the reverse", () => {
    // Mirror of the measured production pair: a fix task BLOCKS a feature task.
    const blocker = createTask({ title: "Fix typecheck (blocker)" });
    const dependent = createTask({ title: "Knowledge revision history (dependent)" });
    addDependency(dependent.id, blocker.id); // dependent --needs blocker

    const blockerEdges = getTaskDependencyEdges(blocker.id)!;
    // The blocker depends on nothing and NOTHING blocks it — it must be
    // dispatchable. The inverted read reported blocked_by=[dependent] here.
    expect(blockerEdges.dependencies).toEqual([]);
    expect(blockerEdges.blocked_by).toEqual([]);
    // Its dependent lives under `blocks` (what this task blocks).
    expect(blockerEdges.blocks).toHaveLength(1);
    expect(blockerEdges.blocks[0]).toMatchObject({ id: dependent.id, status: "pending" });

    const dependentEdges = getTaskDependencyEdges(dependent.id)!;
    // The dependent depends on the blocker and IS blocked by it while pending.
    expect(dependentEdges.dependencies).toHaveLength(1);
    expect(dependentEdges.dependencies[0]).toMatchObject({ id: blocker.id, status: "pending" });
    expect(dependentEdges.blocked_by).toHaveLength(1);
    expect(dependentEdges.blocked_by[0]).toMatchObject({ id: blocker.id });
    expect(dependentEdges.blocks).toEqual([]);
  });

  test("blocked_by empties when the blocker completes; dependencies keeps the edge", () => {
    const blocker = createTask({ title: "Blocker" });
    const dependent = createTask({ title: "Dependent" });
    addDependency(dependent.id, blocker.id);

    completeTask(blocker.id);
    const edges = getTaskDependencyEdges(dependent.id)!;
    expect(edges.dependencies).toHaveLength(1);
    expect(edges.dependencies[0]).toMatchObject({ id: blocker.id, status: "completed" });
    expect(edges.blocked_by).toEqual([]);
  });

  test("a cancelled prerequisite will never complete — it does not block", () => {
    const blocker = createTask({ title: "Cancelled blocker" });
    const dependent = createTask({ title: "Dependent" });
    addDependency(dependent.id, blocker.id);
    updateTask(blocker.id, { status: "cancelled", version: blocker.version });

    const edges = getTaskDependencyEdges(dependent.id)!;
    expect(edges.dependencies).toHaveLength(1);
    expect(edges.blocked_by).toEqual([]);
  });

  test("getTaskWithRelations (show/inspect source) carries the same orientation", () => {
    const blocker = createTask({ title: "Blocker" });
    const dependent = createTask({ title: "Dependent" });
    addDependency(dependent.id, blocker.id);

    const blockerRel = getTaskWithRelations(blocker.id)!;
    expect(blockerRel.dependencies).toEqual([]);
    expect(blockerRel.blocked_by).toEqual([]);
    expect(blockerRel.blocks.map((t: Task) => t.id)).toEqual([dependent.id]);

    const dependentRel = getTaskWithRelations(dependent.id)!;
    expect(dependentRel.dependencies.map((t: Task) => t.id)).toEqual([blocker.id]);
    expect(dependentRel.blocked_by.map((t: Task) => t.id)).toEqual([blocker.id]);
    expect(dependentRel.blocks).toEqual([]);
  });

  test("buildTaskDependencyEdges derives blocked_by from incomplete prerequisites only", () => {
    const done = createTask({ title: "Done prereq" });
    completeTask(done.id);
    const open = createTask({ title: "Open prereq" });
    const dependentRow = createTask({ title: "Root" });
    const downstream = createTask({ title: "Downstream" });

    const payload = buildTaskDependencyEdges(
      { id: dependentRow.id, short_id: dependentRow.short_id },
      [getFresh(done.id), getFresh(open.id)],
      [getFresh(downstream.id)],
    );
    expect(payload.dependencies.map((n) => n.id).sort()).toEqual([done.id, open.id].sort());
    expect(payload.blocked_by.map((n) => n.id)).toEqual([open.id]);
    expect(payload.blocks.map((n) => n.id)).toEqual([downstream.id]);
  });
});

function getFresh(id: string): Task {
  const { getTask } = require("../db/tasks.js") as typeof import("../db/tasks.js");
  return getTask(id)!;
}

// ── CLI end-to-end, local store ─────────────────────────────────────────────

const REPO_ROOT = join(import.meta.dir, "../..");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function runLocal(args: string[], root: string) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: join(root, "home"),
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "todos.db"),
      TODOS_AUTO_PROJECT: "false",
      // Fail-closed ruling (hasna/apps#1613): this env is built from scratch
      // (no ambient spread), so the local store needs the explicit opt-in.
      HASNA_TODOS_LOCAL: "1",
      TODOS_LOCAL: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

describe("dependency orientation regression (CLI, local store)", () => {
  test("deps --json: blocker reports blocked_by=[], dependent reports dependencies=[blocker] + blocked_by=[blocker]", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-deps-orient-local-"));
    tempRoots.push(root);
    const blocker = JSON.parse((await runLocal(["add", "Blocker fix", "-j"], root)).stdout);
    const dependent = JSON.parse((await runLocal(["add", "Dependent feature", "-j"], root)).stdout);
    await runLocal(["deps", dependent.id, "--needs", blocker.id], root);

    const blockerRes = await runLocal(["deps", blocker.id, "--json"], root);
    expect(blockerRes.exitCode).toBe(0);
    const blockerEdges = JSON.parse(blockerRes.stdout);
    expect(blockerEdges.schema_version).toBe("todos.task_dependency_edges.v1");
    expect(blockerEdges.dependencies).toEqual([]);
    expect(blockerEdges.blocked_by).toEqual([]);
    expect(blockerEdges.blocks).toHaveLength(1);
    expect(blockerEdges.blocks[0]).toMatchObject({ id: dependent.id, status: "pending" });

    const dependentRes = await runLocal(["deps", dependent.id, "--json"], root);
    expect(dependentRes.exitCode).toBe(0);
    const dependentEdges = JSON.parse(dependentRes.stdout);
    expect(dependentEdges.dependencies).toHaveLength(1);
    expect(dependentEdges.dependencies[0]).toMatchObject({ id: blocker.id, status: "pending" });
    expect(dependentEdges.blocked_by).toHaveLength(1);
    expect(dependentEdges.blocked_by[0]).toMatchObject({ id: blocker.id });
    expect(dependentEdges.blocks).toEqual([]);

    // Completing the blocker unblocks the dependent; the edge itself remains.
    await runLocal(["--agent", "dependency-finisher", "done", blocker.id], root);
    const after = JSON.parse((await runLocal(["deps", dependent.id, "--json"], root)).stdout);
    expect(after.dependencies).toHaveLength(1);
    expect(after.dependencies[0]).toMatchObject({ id: blocker.id, status: "completed" });
    expect(after.blocked_by).toEqual([]);
  }, 45000);

  test("human output still labels the downstream list Blocks: (display was never wrong)", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-deps-orient-human-"));
    tempRoots.push(root);
    const blocker = JSON.parse((await runLocal(["add", "Upstream", "-j"], root)).stdout);
    const dependent = JSON.parse((await runLocal(["add", "Downstream", "-j"], root)).stdout);
    await runLocal(["deps", dependent.id, "--needs", blocker.id], root);

    const res = await runLocal(["deps", blocker.id], root);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Blocks:");
    expect(res.stdout).toContain("Downstream");
    expect(res.stdout).not.toContain("Depends on:");
  }, 45000);
});

// ── CLI end-to-end, self-hosted store (mock /v1 authority) ──────────────────
//
// The wire payload of `GET /v1/tasks/:id/dependencies` still carries the
// LEGACY field name `blocked_by` for the INCOMING (dependent) edges — old
// clients in the fleet render it as `Blocks:` and would misrender a renamed
// server response. The CLI must translate that wire shape into the corrected
// orientation: incoming edges land under `blocks`, and `blocked_by` is derived
// from the incomplete prerequisites.

const BLOCKER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const DEPENDENT_ID = "cccccccc-3333-4333-8333-333333333333";
const TEST_API_KEY = "hasna_todos_test_key";

function taskFixture(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    short_id: null,
    project_id: null,
    parent_id: null,
    plan_id: null,
    title: `task ${id.slice(0, 8)}`,
    description: null,
    status: "pending",
    priority: "medium",
    tags: [],
    metadata: {},
    version: 1,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

function startServer(options: {
  tasks: Record<string, Record<string, unknown>>;
  edges: Record<string, { dependencies: Array<Record<string, unknown>>; blocked_by: Array<Record<string, unknown>> }>;
}) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      const depsMatch = path.match(/^\/v1\/tasks\/([^/]+)\/dependencies$/);
      if (depsMatch && request.method === "GET") {
        const id = decodeURIComponent(depsMatch[1]!);
        return Response.json(options.edges[id] ?? { dependencies: [], blocked_by: [] });
      }
      const taskMatch = path.match(/^\/v1\/tasks\/([^/]+)$/);
      if (taskMatch && request.method === "GET") {
        const id = decodeURIComponent(taskMatch[1]!);
        const row = options.tasks[id];
        if (row) return Response.json({ task: row });
        return Response.json({ error: "task not found" }, { status: 404 });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
}

async function runCloud(args: string[], root: string, baseUrl: string) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "todos.db"),
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_API_URL: baseUrl,
      HASNA_TODOS_API_KEY: TEST_API_KEY,
}),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

describe("dependency orientation regression (CLI, self-hosted store)", () => {
  test("legacy wire blocked_by (incoming edges) hydrates into blocks; blocked_by comes from incomplete prerequisites", async () => {
    const server = startServer({
      tasks: {
        [BLOCKER_ID]: taskFixture(BLOCKER_ID, { title: "Blocker fix" }),
        [DEPENDENT_ID]: taskFixture(DEPENDENT_ID, { title: "Dependent feature" }),
      },
      edges: {
        // Wire shape as the deployed authority sends it today: `blocked_by`
        // carries the INCOMING edge (the dependent that depends on this task).
        [BLOCKER_ID]: {
          dependencies: [],
          blocked_by: [{ task_id: DEPENDENT_ID, depends_on: BLOCKER_ID }],
        },
        [DEPENDENT_ID]: {
          dependencies: [{ task_id: DEPENDENT_ID, depends_on: BLOCKER_ID }],
          blocked_by: [],
        },
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-deps-orient-cloud-"));
    tempRoots.push(root);
    try {
      const base = `http://127.0.0.1:${server.port}`;

      const blockerRes = await runCloud(["deps", BLOCKER_ID, "--json"], root, base);
      expect(blockerRes.stderr).toBe("");
      expect(blockerRes.exitCode).toBe(0);
      const blockerEdges = JSON.parse(blockerRes.stdout);
      expect(blockerEdges.schema_version).toBe("todos.task_dependency_edges.v1");
      expect(blockerEdges.dependencies).toEqual([]);
      expect(blockerEdges.blocked_by).toEqual([]);
      expect(blockerEdges.blocks).toHaveLength(1);
      expect(blockerEdges.blocks[0]).toMatchObject({ id: DEPENDENT_ID, status: "pending" });

      const dependentRes = await runCloud(["deps", DEPENDENT_ID, "--json"], root, base);
      expect(dependentRes.exitCode).toBe(0);
      const dependentEdges = JSON.parse(dependentRes.stdout);
      expect(dependentEdges.dependencies).toHaveLength(1);
      expect(dependentEdges.dependencies[0]).toMatchObject({ id: BLOCKER_ID, status: "pending" });
      expect(dependentEdges.blocked_by).toHaveLength(1);
      expect(dependentEdges.blocked_by[0]).toMatchObject({ id: BLOCKER_ID });
      expect(dependentEdges.blocks).toEqual([]);
    } finally {
      server.stop(true);
    }
  }, 45000);

  test("a completed remote prerequisite does not appear in blocked_by", async () => {
    const server = startServer({
      tasks: {
        [BLOCKER_ID]: taskFixture(BLOCKER_ID, { title: "Blocker fix", status: "completed" }),
        [DEPENDENT_ID]: taskFixture(DEPENDENT_ID, { title: "Dependent feature" }),
      },
      edges: {
        [DEPENDENT_ID]: {
          dependencies: [{ task_id: DEPENDENT_ID, depends_on: BLOCKER_ID }],
          blocked_by: [],
        },
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-deps-orient-cloud-done-"));
    tempRoots.push(root);
    try {
      const res = await runCloud(["deps", DEPENDENT_ID, "--json"], root, `http://127.0.0.1:${server.port}`);
      expect(res.exitCode).toBe(0);
      const edges = JSON.parse(res.stdout);
      expect(edges.dependencies).toHaveLength(1);
      expect(edges.dependencies[0]).toMatchObject({ id: BLOCKER_ID, status: "completed" });
      expect(edges.blocked_by).toEqual([]);
    } finally {
      server.stop(true);
    }
  }, 45000);
});
