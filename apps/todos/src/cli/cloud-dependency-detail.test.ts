import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const TASK_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const UPSTREAM_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const DOWNSTREAM_ID = "cccccccc-3333-4333-8333-333333333333";
const GHOST_ID = "dddddddd-4444-4444-8444-444444444444";
const TEST_API_KEY = "hasna_todos_test_key";
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function runCli(args: string[], root: string, baseUrl: string) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "todos.db"),
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_STORAGE_MODE: "self_hosted",
      HASNA_TODOS_API_URL: baseUrl,
      HASNA_TODOS_API_KEY: TEST_API_KEY,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

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

/**
 * Mock /v1 server that mirrors the hosted contract described in issue #58: the
 * task row endpoint returns NO relation graphs, and the dependency edges live
 * behind `GET /v1/tasks/:id/dependencies`.
 */
function startServer(options: {
  edges?: { dependencies: Array<Record<string, unknown>>; blocked_by: Array<Record<string, unknown>> };
  known?: Record<string, Record<string, unknown>>;
  depsStatus?: number;
  requests?: string[];
}) {
  const known = options.known ?? {};
  const requests = options.requests ?? [];
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      const depsMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/dependencies$/);
      if (depsMatch && request.method === "GET") {
        if (options.depsStatus && options.depsStatus >= 400) {
          return Response.json({ error: "boom" }, { status: options.depsStatus });
        }
        if (decodeURIComponent(depsMatch[1]!) !== TASK_ID) {
          return Response.json({ dependencies: [], blocked_by: [] });
        }
        return Response.json(options.edges ?? { dependencies: [], blocked_by: [] });
      }
      if (url.pathname === `/v1/tasks/${TASK_ID}/comments` && request.method === "GET") {
        return Response.json({ comments: [], count: 0, has_more: false, next_cursor: null });
      }
      const taskMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
      if (taskMatch && request.method === "GET") {
        const ref = decodeURIComponent(taskMatch[1]!);
        if (ref === TASK_ID) return Response.json({ task: taskFixture(TASK_ID, { title: "Cloud dependency regression" }) });
        const row = known[ref];
        if (row) return Response.json({ task: row });
        return Response.json({ error: "task not found" }, { status: 404 });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
}

describe("cloud task detail dependencies (issue #58)", () => {
  test("show --json and inspect --json hydrate dependency edges the deps endpoint returns", async () => {
    const requests: string[] = [];
    const server = startServer({
      requests,
      edges: {
        dependencies: [{ task_id: TASK_ID, depends_on: UPSTREAM_ID, created_at: "2026-07-10T00:00:00.000Z" }],
        blocked_by: [{ task_id: DOWNSTREAM_ID, depends_on: TASK_ID, created_at: "2026-07-10T00:00:00.000Z" }],
      },
      known: {
        [UPSTREAM_ID]: taskFixture(UPSTREAM_ID, { title: "Upstream blocker", status: "in_progress" }),
        [DOWNSTREAM_ID]: taskFixture(DOWNSTREAM_ID, { title: "Downstream consumer", status: "pending" }),
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-deps-detail-"));
    tempRoots.push(root);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const shown = await runCli(["--json", "show", TASK_ID], root, baseUrl);
      expect(shown.stderr).toBe("");
      expect(shown.exitCode).toBe(0);
      const shownTask = JSON.parse(shown.stdout);
      expect(shownTask.dependencies).toHaveLength(1);
      expect(shownTask.dependencies[0]).toMatchObject({ id: UPSTREAM_ID, title: "Upstream blocker", status: "in_progress" });
      expect(shownTask.blocked_by).toHaveLength(1);
      expect(shownTask.blocked_by[0]).toMatchObject({ id: DOWNSTREAM_ID, title: "Downstream consumer", status: "pending" });

      const inspected = await runCli(["--json", "inspect", TASK_ID], root, baseUrl);
      expect(inspected.stderr).toBe("");
      expect(inspected.exitCode).toBe(0);
      const inspectedTask = JSON.parse(inspected.stdout);
      expect(inspectedTask.dependencies[0]).toMatchObject({ id: UPSTREAM_ID, title: "Upstream blocker", status: "in_progress" });
      expect(inspectedTask.blocked_by[0]).toMatchObject({ id: DOWNSTREAM_ID, title: "Downstream consumer" });

      expect(requests).toContain(`GET /v1/tasks/${TASK_ID}/dependencies`);
    } finally {
      server.stop(true);
    }
  });

  test("human inspect renders dependency status and the BLOCKED warning for unfinished upstream tasks", async () => {
    const server = startServer({
      edges: {
        dependencies: [{ task_id: TASK_ID, depends_on: UPSTREAM_ID }],
        blocked_by: [{ task_id: DOWNSTREAM_ID, depends_on: TASK_ID }],
      },
      known: {
        [UPSTREAM_ID]: taskFixture(UPSTREAM_ID, { title: "Upstream blocker", status: "in_progress" }),
        [DOWNSTREAM_ID]: taskFixture(DOWNSTREAM_ID, { title: "Downstream consumer" }),
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-deps-human-"));
    tempRoots.push(root);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const inspected = await runCli(["inspect", TASK_ID], root, baseUrl);
      expect(inspected.stderr).toBe("");
      expect(inspected.exitCode).toBe(0);
      expect(inspected.stdout).toContain("Depends on (1)");
      expect(inspected.stdout).toContain("Upstream blocker");
      expect(inspected.stdout).toContain("BLOCKED by 1 unfinished dep(s)");
      expect(inspected.stdout).toContain("Blocks (1)");
      expect(inspected.stdout).toContain("Downstream consumer");

      const shown = await runCli(["show", TASK_ID], root, baseUrl);
      expect(shown.exitCode).toBe(0);
      expect(shown.stdout).toContain("Depends on (1)");
      expect(shown.stdout).toContain("Blocks (1)");
    } finally {
      server.stop(true);
    }
  });

  test("a task with no edges still renders empty relation arrays without extra lookups", async () => {
    const requests: string[] = [];
    const server = startServer({ requests, edges: { dependencies: [], blocked_by: [] } });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-deps-empty-"));
    tempRoots.push(root);
    try {
      const shown = await runCli(["--json", "show", TASK_ID], root, `http://127.0.0.1:${server.port}`);
      expect(shown.stderr).toBe("");
      expect(shown.exitCode).toBe(0);
      const task = JSON.parse(shown.stdout);
      expect(task.dependencies).toEqual([]);
      expect(task.blocked_by).toEqual([]);
      // Only the task row, its comments and the dependency edges — no per-edge fan-out.
      expect(requests).toEqual([
        `GET /v1/tasks/${TASK_ID}`,
        `GET /v1/tasks/${TASK_ID}/comments`,
        `GET /v1/tasks/${TASK_ID}/dependencies`,
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("more edges than the hydration concurrency window are each fetched exactly once", async () => {
    // Guards the bounded-concurrency worker loop: every edge must be visited
    // (none dropped past the window) and duplicate edge rows must collapse to a
    // single task lookup.
    const requests: string[] = [];
    const upstreamIds = Array.from({ length: 14 }, (_, index) => `eeeeeeee-0000-4000-8000-${String(index).padStart(12, "0")}`);
    const known: Record<string, Record<string, unknown>> = {};
    for (const [index, id] of upstreamIds.entries()) known[id] = taskFixture(id, { title: `Upstream ${index}` });
    known[DOWNSTREAM_ID] = taskFixture(DOWNSTREAM_ID, { title: "Downstream consumer" });
    const server = startServer({
      requests,
      known,
      edges: {
        // The last row repeats an earlier edge — the server may return duplicates.
        dependencies: [...upstreamIds, upstreamIds[0]!].map((depends_on) => ({ task_id: TASK_ID, depends_on })),
        blocked_by: [{ task_id: DOWNSTREAM_ID, depends_on: TASK_ID }],
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-deps-concurrency-"));
    tempRoots.push(root);
    try {
      const shown = await runCli(["--json", "show", TASK_ID], root, `http://127.0.0.1:${server.port}`);
      expect(shown.stderr).toBe("");
      expect(shown.exitCode).toBe(0);
      const task = JSON.parse(shown.stdout);
      expect(task.dependencies.map((d: { id: string }) => d.id)).toEqual(upstreamIds);
      expect(task.dependencies.every((d: { title: string }) => d.title.startsWith("Upstream "))).toBe(true);
      expect(task.blocked_by.map((d: { id: string }) => d.id)).toEqual([DOWNSTREAM_ID]);
      const lookups = requests.filter((entry) => /^GET \/v1\/tasks\/[^/]+$/.test(entry));
      // The task itself + 14 upstream + 1 downstream, no repeats.
      expect(lookups).toHaveLength(16);
      expect(new Set(lookups).size).toBe(16);
    } finally {
      server.stop(true);
    }
  });

  test("an edge pointing at a missing task keeps the valid relations and surfaces a placeholder", async () => {
    const server = startServer({
      edges: {
        dependencies: [
          { task_id: TASK_ID, depends_on: UPSTREAM_ID },
          { task_id: TASK_ID, depends_on: GHOST_ID },
        ],
        blocked_by: [],
      },
      known: { [UPSTREAM_ID]: taskFixture(UPSTREAM_ID, { title: "Upstream blocker", status: "completed" }) },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-deps-ghost-"));
    tempRoots.push(root);
    try {
      const shown = await runCli(["--json", "show", TASK_ID], root, `http://127.0.0.1:${server.port}`);
      expect(shown.exitCode).toBe(0);
      const task = JSON.parse(shown.stdout);
      expect(task.dependencies).toHaveLength(2);
      expect(task.dependencies.map((d: { id: string }) => d.id).sort()).toEqual([GHOST_ID, UPSTREAM_ID].sort());
      const ghost = task.dependencies.find((d: { id: string }) => d.id === GHOST_ID);
      expect(ghost.title).toContain("unavailable");
    } finally {
      server.stop(true);
    }
  });

  test("a dependency endpoint failure does not take down the whole detail view", async () => {
    const server = startServer({ depsStatus: 500 });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-deps-error-"));
    tempRoots.push(root);
    try {
      const shown = await runCli(["--json", "show", TASK_ID], root, `http://127.0.0.1:${server.port}`);
      expect(shown.exitCode).toBe(0);
      const task = JSON.parse(shown.stdout);
      expect(task.id).toBe(TASK_ID);
      expect(task.dependencies).toEqual([]);
      expect(task.blocked_by).toEqual([]);
      expect(shown.stderr).toContain("dependencies");
    } finally {
      server.stop(true);
    }
  });
});
