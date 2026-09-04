import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliverTodosApiKeyViaDisk } from "../testing.js";

/**
 * `todos deps` machine-readable read (todos deps --json).
 *
 * Covers both storage modes end-to-end through the real CLI:
 *   - a per-task edge read (`deps <id> --json`) that carries ids + status and
 *     is IDENTICAL in shape whether the store is local SQLite or a self-hosted
 *     authority, and
 *   - a whole-project graph read (`deps --project <ref> --json`).
 * Human output and the existing `--graph --json` shape must be unchanged.
 */

const REPO_ROOT = join(import.meta.dir, "../..");
const TASK_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const UPSTREAM_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const DOWNSTREAM_ID = "cccccccc-3333-4333-8333-333333333333";
const PROJECT_ID = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GA_ID = "22222222-aaaa-4aaa-8aaa-000000000001";
const GB_ID = "22222222-aaaa-4aaa-8aaa-000000000002";
const GC_ID = "22222222-aaaa-4aaa-8aaa-000000000003";
const TEST_FIXTURE_VALUE = "hasna_todos_test_key";
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- Local mode -----------------------------------------------------------

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
      // Local SQLite is opt-in only since the fail-closed ruling (hasna/apps#1613).
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

describe("deps --json (local store)", () => {
  test("per-task edges carry ids + status in both directions with a versioned schema", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-deps-local-"));
    tempRoots.push(root);
    const project = JSON.parse(
      (await runLocal(["projects", "--add", join(root, "proj"), "--name", "LocalDeps", "-j"], root)).stdout,
    );
    const a = JSON.parse((await runLocal(["add", "A", "--project", project.id, "-j"], root)).stdout);
    const b = JSON.parse((await runLocal(["add", "B", "--project", project.id, "-j"], root)).stdout);
    const c = JSON.parse((await runLocal(["add", "C", "--project", project.id, "-j"], root)).stdout);
    await runLocal(["deps", b.id, "--needs", a.id], root);
    await runLocal(["deps", c.id, "--needs", b.id], root);

    const res = await runLocal(["deps", b.id, "--json"], root);
    expect(res.exitCode).toBe(0);
    const edges = JSON.parse(res.stdout);
    expect(edges.schema_version).toBe("todos.task_dependency_edges.v1");
    expect(edges.task_id).toBe(b.id);
    expect(edges.dependencies).toHaveLength(1);
    expect(edges.dependencies[0]).toMatchObject({ id: a.id, title: "A", status: "pending" });
    // A is pending, so it blocks B; C (B's dependent) lives under `blocks`.
    expect(edges.blocked_by).toHaveLength(1);
    expect(edges.blocked_by[0]).toMatchObject({ id: a.id, title: "A", status: "pending" });
    expect(edges.blocks).toHaveLength(1);
    expect(edges.blocks[0]).toMatchObject({ id: c.id, title: "C", status: "pending" });
  });

  test("human output is unchanged (no schema_version, keeps Depends on:/Blocks:)", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-deps-local-human-"));
    tempRoots.push(root);
    const a = JSON.parse((await runLocal(["add", "Upstream", "-j"], root)).stdout);
    const b = JSON.parse((await runLocal(["add", "Downstream", "-j"], root)).stdout);
    await runLocal(["deps", b.id, "--needs", a.id], root);

    const res = await runLocal(["deps", b.id], root);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Depends on:");
    expect(res.stdout).toContain("Upstream");
    expect(res.stdout).not.toContain("schema_version");
  });

  test("whole-project graph exposes nodes and adjacency edges", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-deps-local-graph-"));
    tempRoots.push(root);
    const project = JSON.parse(
      (await runLocal(["projects", "--add", join(root, "proj"), "--name", "LocalGraph", "-j"], root)).stdout,
    );
    const a = JSON.parse((await runLocal(["add", "A", "--project", project.id, "-j"], root)).stdout);
    const b = JSON.parse((await runLocal(["add", "B", "--project", project.id, "-j"], root)).stdout);
    const c = JSON.parse((await runLocal(["add", "C", "--project", project.id, "-j"], root)).stdout);
    await runLocal(["deps", b.id, "--needs", a.id], root);
    await runLocal(["deps", c.id, "--needs", b.id], root);

    const res = await runLocal(["deps", "--project", project.id, "--json"], root);
    expect(res.exitCode).toBe(0);
    const graph = JSON.parse(res.stdout);
    expect(graph.schema_version).toBe("todos.project_dependency_graph.v1");
    expect(graph.project_id).toBe(project.id);
    expect(graph.nodes.map((n: { id: string }) => n.id).sort()).toEqual([a.id, b.id, c.id].sort());
    const pairs = graph.edges.map((e: { task_id: string; depends_on: string }) => `${e.task_id}->${e.depends_on}`).sort();
    expect(pairs).toEqual([`${b.id}->${a.id}`, `${c.id}->${b.id}`].sort());
    expect(graph.cycles).toEqual([]);
  });

  test("whole-project graph accepts the documented --graph flag without a task id", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-deps-local-project-graph-flag-"));
    tempRoots.push(root);
    const project = JSON.parse(
      (await runLocal(["projects", "--add", join(root, "proj"), "--name", "LocalProjectGraphFlag", "-j"], root)).stdout,
    );
    const a = JSON.parse((await runLocal(["add", "A", "--project", project.id, "-j"], root)).stdout);
    const b = JSON.parse((await runLocal(["add", "B", "--project", project.id, "-j"], root)).stdout);
    const c = JSON.parse(
      (await runLocal(["add", "C", "--project", project.id, "--parent", b.id, "-j"], root)).stdout,
    );
    await runLocal(["deps", b.id, "--needs", a.id], root);
    await runLocal(["deps", c.id, "--needs", b.id], root);

    const res = await runLocal(["deps", "--project", project.id, "--graph", "--json"], root);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(res.stderr).not.toContain('"event":"todos-local-fallback"');
    expect(res.exitCode).toBe(0);
    const graph = JSON.parse(res.stdout);
    expect(graph.schema_version).toBe("todos.project_dependency_graph.v1");
    expect(graph.project_id).toBe(project.id);
    expect(graph.nodes.map((n: { id: string }) => n.id).sort()).toEqual([a.id, b.id, c.id].sort());
    const pairs = graph.edges.map((e: { task_id: string; depends_on: string }) => `${e.task_id}->${e.depends_on}`).sort();
    expect(pairs).toEqual([`${b.id}->${a.id}`, `${c.id}->${b.id}`].sort());
    expect(graph.cycles).toEqual([]);
  });

  test("--graph --json still emits the recursive graph shape (regression guard)", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-deps-local-legacy-"));
    tempRoots.push(root);
    const a = JSON.parse((await runLocal(["add", "A", "-j"], root)).stdout);
    const b = JSON.parse((await runLocal(["add", "B", "-j"], root)).stdout);
    await runLocal(["deps", a.id, "--needs", b.id], root);

    const res = await runLocal(["deps", a.id, "--graph", "--json"], root);
    expect(res.exitCode).toBe(0);
    const graph = JSON.parse(res.stdout);
    expect(graph.task.id).toBe(a.id);
    expect(graph.depends_on[0].task.id).toBe(b.id);
    // The legacy graph node does NOT carry the new edge schema wrapper.
    expect(graph.schema_version).toBeUndefined();
  });

  test("no id and no resolvable project is a clear error, not a crash", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-deps-local-noargs-"));
    tempRoots.push(root);
    const res = await runLocal(["deps"], root);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("--project");
  });

  test("a mutating flag with no id fails loudly instead of silently dropping the write", async () => {
    // Regression: with `deps [id]` optional, `todos deps --needs <dep>` (id
    // forgotten) must not be reinterpreted as a whole-project read that ignores
    // the mutation. It must error and NOT create/modify any dependency.
    const root = mkdtempSync(join(tmpdir(), "todos-deps-local-guard-"));
    tempRoots.push(root);
    const project = JSON.parse(
      (await runLocal(["projects", "--add", join(root, "proj"), "--name", "GuardProj", "-j"], root)).stdout,
    );
    const a = JSON.parse((await runLocal(["add", "A", "--project", project.id, "-j"], root)).stdout);
    const b = JSON.parse((await runLocal(["add", "B", "--project", project.id, "-j"], root)).stdout);

    const res = await runLocal(["deps", "--needs", a.id], root);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("task id is required");

    // No edge was created on either task.
    const bEdges = JSON.parse((await runLocal(["deps", b.id, "--json"], root)).stdout);
    expect(bEdges.dependencies).toEqual([]);
    const aEdges = JSON.parse((await runLocal(["deps", a.id, "--json"], root)).stdout);
    expect(aEdges.dependencies).toEqual([]);
  });
});

// --- Cloud / self-hosted mode ---------------------------------------------

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

function projectFixture(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `project ${id.slice(0, 8)}`,
    path: `/tmp/${id}`,
    task_list_id: `todos-${id}`,
    description: null,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Mock `/v1` authority. Task rows carry no relation graph (issue #58), so edges
 * live behind `GET /v1/tasks/:id/dependencies`; the deps read hydrates them.
 */
function startServer(options: {
  tasks: Record<string, Record<string, unknown>>;
  edges: Record<string, { dependencies: Array<Record<string, unknown>>; blocked_by: Array<Record<string, unknown>> }>;
  projects?: Array<Record<string, unknown>>;
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
      if (path === "/v1/tasks" && request.method === "GET") {
        const wanted = url.searchParams.get("project_id");
        const includeSubtasks = url.searchParams.get("include_subtasks") === "true";
        const rows = Object.values(options.tasks).filter(
          (t) => (!wanted || t["project_id"] === wanted) && (includeSubtasks || !t["parent_id"]),
        );
        return Response.json({ tasks: rows });
      }
      if (path === "/v1/projects" && request.method === "GET") {
        return Response.json({ projects: options.projects ?? [] });
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
      HASNA_TODOS_API_KEY: TEST_FIXTURE_VALUE,
}),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

describe("deps --json (self-hosted store)", () => {
  test("per-task edges are hydrated to ids + status — the same shape as local", async () => {
    const server = startServer({
      tasks: {
        [TASK_ID]: taskFixture(TASK_ID, { title: "Root" }),
        [UPSTREAM_ID]: taskFixture(UPSTREAM_ID, { title: "Upstream blocker", status: "in_progress" }),
        [DOWNSTREAM_ID]: taskFixture(DOWNSTREAM_ID, { title: "Downstream consumer", status: "pending" }),
      },
      edges: {
        [TASK_ID]: {
          dependencies: [{ task_id: TASK_ID, depends_on: UPSTREAM_ID }],
          blocked_by: [{ task_id: DOWNSTREAM_ID, depends_on: TASK_ID }],
        },
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-deps-cloud-"));
    tempRoots.push(root);
    try {
      const res = await runCloud(["deps", TASK_ID, "--json"], root, `http://127.0.0.1:${server.port}`);
    expect(res.stderr).toBe("");
      expect(res.exitCode).toBe(0);
      const edges = JSON.parse(res.stdout);
      expect(edges.schema_version).toBe("todos.task_dependency_edges.v1");
      expect(edges.task_id).toBe(TASK_ID);
      expect(edges.dependencies).toHaveLength(1);
      expect(edges.dependencies[0]).toMatchObject({ id: UPSTREAM_ID, title: "Upstream blocker", status: "in_progress" });
      // The in-progress upstream still blocks this task; the downstream
      // dependent lands under `blocks` (regression 4599ef37 — it used to be
      // misfiled in `blocked_by`).
      expect(edges.blocked_by).toHaveLength(1);
      expect(edges.blocked_by[0]).toMatchObject({ id: UPSTREAM_ID, title: "Upstream blocker", status: "in_progress" });
      expect(edges.blocks).toHaveLength(1);
      expect(edges.blocks[0]).toMatchObject({ id: DOWNSTREAM_ID, title: "Downstream consumer", status: "pending" });
    } finally {
      server.stop(true);
    }
  });

  test("an unreadable edge target is dropped (matches local), not surfaced as a phantom pending node", async () => {
    // The dependency target is NOT in `tasks`, so the /v1 row read 404s and
    // cloudGetTaskRelations would synthesize an `unresolved` placeholder. The
    // read must DROP it — mirroring the local SQL JOIN — so a scheduler never
    // sees a fake "pending" blocker (or, worse, mistakes it for a real task).
    const server = startServer({
      tasks: { [TASK_ID]: taskFixture(TASK_ID, { title: "Root" }) },
      edges: {
        [TASK_ID]: {
          dependencies: [{ task_id: TASK_ID, depends_on: "99999999-9999-4999-8999-999999999999" }],
          blocked_by: [],
        },
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-deps-cloud-dangling-"));
    tempRoots.push(root);
    try {
      const res = await runCloud(["deps", TASK_ID, "--json"], root, `http://127.0.0.1:${server.port}`);
      expect(res.exitCode).toBe(0);
      const edges = JSON.parse(res.stdout);
      expect(edges.dependencies).toEqual([]);
      expect(edges.blocked_by).toEqual([]);
      expect(edges.blocks).toEqual([]);
    } finally {
      server.stop(true);
    }
  });

  test("whole-project graph assembles nodes + edges from the list and per-task edges", async () => {
    const server = startServer({
      projects: [projectFixture(PROJECT_ID, { name: "Cloud Graph", path: "/tmp/cloud-graph" })],
      tasks: {
        [GA_ID]: taskFixture(GA_ID, { title: "GA", project_id: PROJECT_ID }),
        [GB_ID]: taskFixture(GB_ID, { title: "GB", project_id: PROJECT_ID }),
        [GC_ID]: taskFixture(GC_ID, { title: "GC", project_id: PROJECT_ID, parent_id: GB_ID }),
      },
      edges: {
        [GB_ID]: { dependencies: [{ task_id: GB_ID, depends_on: GA_ID }], blocked_by: [] },
        [GC_ID]: { dependencies: [{ task_id: GC_ID, depends_on: GB_ID }], blocked_by: [] },
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-deps-cloud-graph-"));
    tempRoots.push(root);
    try {
      for (const args of [
        ["deps", "--project", PROJECT_ID, "--json"],
        ["deps", "--project", PROJECT_ID, "--graph", "--json"],
      ]) {
        const res = await runCloud(args, root, `http://127.0.0.1:${server.port}`);
    expect(res.stderr).toBe("");
        expect(res.exitCode).toBe(0);
        const graph = JSON.parse(res.stdout);
        expect(graph.schema_version).toBe("todos.project_dependency_graph.v1");
        expect(graph.project_id).toBe(PROJECT_ID);
        expect(graph.nodes.map((n: { id: string }) => n.id).sort()).toEqual([GA_ID, GB_ID, GC_ID].sort());
        const pairs = graph.edges.map((e: { task_id: string; depends_on: string }) => `${e.task_id}->${e.depends_on}`).sort();
        expect(pairs).toEqual([`${GB_ID}->${GA_ID}`, `${GC_ID}->${GB_ID}`].sort());
        expect(graph.cycles).toEqual([]);
      }
    } finally {
      server.stop(true);
    }
  });
});
