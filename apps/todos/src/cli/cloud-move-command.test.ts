import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../db/schema.js";
import { handleV1Request, type V1RequestDependencies } from "../server/v1.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
import { deliverTodosApiKeyViaDisk } from "../testing.js";

// End-to-end proof that a task can be re-parented across projects/task-lists
// against the remote /v1 authority: the task keeps its id, lands in project B
// (and its task list), and is gone from project A. Mirrors the Bun.serve mock
// pattern used by the other cloud CLI command tests.

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_API_KEY = "hasna_todos_test_key";

const TASK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const LIST_A = "44444444-4444-4444-8444-444444444444";
const LIST_B = "33333333-3333-4333-8333-333333333333";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function runCli(args: string[], root: string, baseUrl: string) {
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

function projectRecord(id: string, name: string, slug: string) {
  return {
    id,
    name,
    path: `/repos/${slug}`,
    description: null,
    task_list_id: slug,
    task_prefix: null,
    task_counter: 0,
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
  };
}

function taskListRecord(id: string, slug: string, projectId: string) {
  return {
    id,
    project_id: projectId,
    slug,
    name: slug,
    description: null,
    metadata: {},
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
  };
}

function createComposedAuthority() {
  const db = new Database(":memory:");
  runMigrations(db);
  const store = createLocalSqliteTodosStorageAdapter({ db });
  const dependencies: V1RequestDependencies = {
    ensureSchema: async () => {},
    getStorageAdapter: () => store,
    getVerifier: () => ({
      authenticate: async () => ({
        ok: true as const,
        principal: {
          kid: "clear-list-composition",
          app: "todos",
          scopes: ["todos:*"],
          agent: "composition-agent",
          claims: {
            v: 1,
            kid: "clear-list-composition",
            app: "todos",
            scopes: ["todos:*"],
            iat: 0,
            exp: null,
          },
        },
      }),
    }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const response = await handleV1Request(request, url, dependencies);
      return response ?? Response.json({ error: "not found" }, { status: 404 });
    },
  });
  return { db, server, store };
}

describe("cloud CLI move command", () => {
  test("move --clear-list fails closed when the authority retains a stale task_list_id", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    let task: Record<string, unknown> = {
      id: TASK_ID,
      short_id: "BPRJ-1",
      title: "Stale list after cross-project move",
      description: null,
      status: "in_progress",
      priority: "medium",
      project_id: PROJECT_B,
      task_list_id: LIST_A,
      plan_id: null,
      assigned_to: "agent-chief-harness",
      tags: [],
      version: 8,
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    };
    const projects = [
      projectRecord(PROJECT_A, "Project A", "project-a"),
      projectRecord(PROJECT_B, "Project B", "project-b"),
    ];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = ["POST", "PATCH", "PUT"].includes(request.method) ? await request.json() : undefined;
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === `/v1/tasks/${TASK_ID}` && request.method === "GET") {
          return Response.json({ task });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}` && request.method === "PATCH") {
          const patch = body as Record<string, unknown>;
          // Reproduce the hosted false-success contract: the authority accepts
          // the request but silently preserves the old list relationship.
          task = {
            ...task,
            ...patch,
            task_list_id: task.task_list_id,
            version: (task.version as number) + 1,
          };
          return Response.json({ task });
        }
        if (url.pathname === "/v1/projects" && request.method === "GET") {
          return Response.json({ projects, count: projects.length });
        }
        return Response.json({ error: `no route for ${request.method} ${url.pathname}` }, { status: 404 });
      },
    });

    const root = mkdtempSync(join(tmpdir(), "todos-cloud-move-clear-list-stale-"));
    tempRoots.push(root);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const moved = await runCli(
        ["--json", "move", TASK_ID, "--to-project", PROJECT_B, "--clear-list"],
        root,
        baseUrl,
      );
      expect(moved.exitCode).toBe(1);
      expect(JSON.parse(moved.stdout)).toEqual({
        error: expect.stringContaining("TASK_REPARENT_PERSISTENCE_UNVERIFIED"),
      });
      expect(moved.stderr).toContain("TASK_REPARENT_PERSISTENCE_UNVERIFIED");

      const patch = requests.find((request) =>
        request.method === "PATCH" && request.path === `/v1/tasks/${TASK_ID}`
      );
      expect(patch?.body).toMatchObject({ project_id: PROJECT_B, task_list_id: null });
      expect(task).toMatchObject({
        id: TASK_ID,
        project_id: PROJECT_B,
        task_list_id: LIST_A,
        status: "in_progress",
        assigned_to: "agent-chief-harness",
      });
    } finally {
      server.stop(true);
    }
  });

  test("update --clear-list does not print success when the authority retains a stale task_list_id", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    let task: Record<string, unknown> = {
      id: TASK_ID,
      short_id: "BPRJ-2",
      title: "Stale list through update",
      description: null,
      status: "in_progress",
      priority: "medium",
      project_id: PROJECT_B,
      task_list_id: LIST_A,
      plan_id: null,
      assigned_to: "agent-chief-harness",
      tags: [],
      version: 8,
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = ["POST", "PATCH", "PUT"].includes(request.method) ? await request.json() : undefined;
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === `/v1/tasks/${TASK_ID}` && request.method === "GET") {
          return Response.json({ task });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}` && request.method === "PATCH") {
          const patch = body as Record<string, unknown>;
          task = {
            ...task,
            ...patch,
            task_list_id: task.task_list_id,
            version: (task.version as number) + 1,
          };
          return Response.json({ task });
        }
        return Response.json({ error: `no route for ${request.method} ${url.pathname}` }, { status: 404 });
      },
    });

    const root = mkdtempSync(join(tmpdir(), "todos-cloud-update-clear-list-stale-"));
    tempRoots.push(root);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const updated = await runCli(["update", TASK_ID, "--clear-list"], root, baseUrl);
      expect(updated.exitCode).toBe(1);
      expect(updated.stdout).not.toContain("Task updated:");
      expect(updated.stderr).toContain("TASK_REPARENT_PERSISTENCE_UNVERIFIED");

      const patch = requests.find((request) =>
        request.method === "PATCH" && request.path === `/v1/tasks/${TASK_ID}`
      );
      expect(patch?.body).toMatchObject({ task_list_id: null });
      expect(task).toMatchObject({
        id: TASK_ID,
        project_id: PROJECT_B,
        task_list_id: LIST_A,
        status: "in_progress",
        assigned_to: "agent-chief-harness",
      });
    } finally {
      server.stop(true);
    }
  });

  test("JSON move --clear-list persists through the real v1 and SQLite authority twice without replacing the task", async () => {
    const authority = createComposedAuthority();
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-move-clear-list-composition-"));
    tempRoots.push(root);
    try {
      const projectA = await authority.store.projects.create({ name: "Project A", path: "/repos/project-a" });
      const projectB = await authority.store.projects.create({ name: "Project B", path: "/repos/project-b" });
      const listA = await authority.store.taskLists.create({
        name: "List A",
        slug: "list-a",
        project_id: projectA.id,
      });
      const seeded = await authority.store.tasks.create({
        title: "Move clear-list composition",
        project_id: projectA.id,
        task_list_id: listA.id,
        status: "in_progress",
        assigned_to: "agent-chief-harness",
      });
      const sentinel = await authority.store.audit.logTaskChange(
        seeded.id,
        "fixture",
        "title",
        null,
        seeded.title,
        "composition-agent",
      );
      const baseUrl = `http://127.0.0.1:${authority.server.port}`;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const moved = await runCli(
          ["--json", "move", seeded.id, "--to-project", projectB.id, "--clear-list"],
          root,
          baseUrl,
        );
        expect(moved).toMatchObject({ exitCode: 0, stderr: "" });
        expect(JSON.parse(moved.stdout)).toMatchObject({
          id: seeded.id,
          project_id: projectB.id,
          task_list_id: null,
          status: "in_progress",
          assigned_to: "agent-chief-harness",
        });
        expect(await authority.store.tasks.get(seeded.id)).toMatchObject({
          id: seeded.id,
          project_id: projectB.id,
          task_list_id: null,
          status: "in_progress",
          assigned_to: "agent-chief-harness",
          created_at: seeded.created_at,
        });
      }

      expect(await authority.store.audit.getTaskHistory(seeded.id)).toContainEqual(
        expect.objectContaining({ id: sentinel.id, task_id: seeded.id }),
      );
      expect(existsSync(join(root, "todos.db"))).toBe(false);
    } finally {
      authority.server.stop(true);
      authority.db.close();
    }
  });

  test("human update --clear-list persists, while preserve, explicit-list, and project-only controls keep their contracts", async () => {
    const authority = createComposedAuthority();
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-update-clear-list-composition-"));
    tempRoots.push(root);
    try {
      const projectA = await authority.store.projects.create({ name: "Project A", path: "/repos/project-a" });
      const projectB = await authority.store.projects.create({ name: "Project B", path: "/repos/project-b" });
      const listA = await authority.store.taskLists.create({
        name: "List A",
        slug: "list-a",
        project_id: projectA.id,
      });
      const listB = await authority.store.taskLists.create({
        name: "List B",
        slug: "list-b",
        project_id: projectB.id,
      });
      const seed = (title: string) => authority.store.tasks.create({
        title,
        project_id: projectA.id,
        task_list_id: listA.id,
        status: "in_progress",
        assigned_to: "agent-chief-harness",
      });
      const clearViaUpdate = await seed("Clear through update");
      const preserveWithoutFlag = await seed("Preserve without clear flag");
      const explicitListMove = await seed("Move to explicit list");
      const projectOnlyMove = await seed("Move project only");
      const baseUrl = `http://127.0.0.1:${authority.server.port}`;

      const cleared = await runCli(["update", clearViaUpdate.id, "--clear-list"], root, baseUrl);
      expect(cleared).toMatchObject({ exitCode: 0, stderr: "" });
      expect(cleared.stdout).toContain("Task updated:");
      expect(await authority.store.tasks.get(clearViaUpdate.id)).toMatchObject({
        id: clearViaUpdate.id,
        project_id: projectA.id,
        task_list_id: null,
        status: "in_progress",
        assigned_to: "agent-chief-harness",
      });

      const preserved = await runCli(
        ["--json", "move", preserveWithoutFlag.id, "--to-project", projectA.id],
        root,
        baseUrl,
      );
      expect(preserved).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(preserved.stdout)).toMatchObject({
        id: preserveWithoutFlag.id,
        project_id: projectA.id,
        task_list_id: listA.id,
      });

      const movedToList = await runCli(
        ["--json", "move", explicitListMove.id, "--to-project", projectB.id, "--to-list", listB.id],
        root,
        baseUrl,
      );
      expect(movedToList).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(movedToList.stdout)).toMatchObject({
        id: explicitListMove.id,
        project_id: projectB.id,
        task_list_id: listB.id,
        status: "in_progress",
        assigned_to: "agent-chief-harness",
      });

      const movedProjectOnly = await runCli(
        ["--json", "move", projectOnlyMove.id, "--to-project", projectB.id],
        root,
        baseUrl,
      );
      expect(movedProjectOnly).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(movedProjectOnly.stdout)).toMatchObject({
        id: projectOnlyMove.id,
        project_id: projectB.id,
        task_list_id: null,
        status: "in_progress",
        assigned_to: "agent-chief-harness",
      });
      expect(existsSync(join(root, "todos.db"))).toBe(false);
    } finally {
      authority.server.stop(true);
      authority.db.close();
    }
  });

  test("re-parents a task from project A to project B and its task list", async () => {
    const requests: Array<{ method: string; path: string; query: string; body?: unknown }> = [];
    let task: Record<string, unknown> = {
      id: TASK_ID,
      short_id: "APRJ-1",
      title: "Portable task",
      description: null,
      status: "pending",
      priority: "medium",
      project_id: PROJECT_A,
      task_list_id: LIST_A,
      plan_id: null,
      assigned_to: null,
      tags: [],
      version: 3,
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    };
    const taskLists = [
      taskListRecord(LIST_A, "list-a", PROJECT_A),
      taskListRecord(LIST_B, "list-b", PROJECT_B),
    ];
    const projects = [
      projectRecord(PROJECT_A, "Project A", "project-a"),
      projectRecord(PROJECT_B, "Project B", "project-b"),
    ];

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = ["POST", "PATCH", "PUT"].includes(request.method) ? await request.json() : undefined;
        requests.push({ method: request.method, path: url.pathname, query: url.search, body });

        if (url.pathname === `/v1/tasks/${TASK_ID}` && request.method === "GET") {
          return Response.json({ task });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}` && (request.method === "PATCH" || request.method === "PUT")) {
          task = { ...task, ...(body as object), version: (task.version as number) + 1 };
          return Response.json({ task });
        }
        if (url.pathname === "/v1/projects" && request.method === "GET") {
          return Response.json({ projects, count: projects.length });
        }
        if (url.pathname === "/v1/task-lists" && request.method === "GET") {
          const projectId = url.searchParams.get("project_id");
          const filtered = projectId ? taskLists.filter((l) => l.project_id === projectId) : taskLists;
          return Response.json({ task_lists: filtered, count: filtered.length });
        }
        if (url.pathname === "/v1/tasks" && request.method === "GET") {
          const projectId = url.searchParams.get("project_id");
          const match = !projectId || task.project_id === projectId ? [task] : [];
          return Response.json({ tasks: match, count: match.length, total: match.length });
        }
        return Response.json({ error: `no route for ${request.method} ${url.pathname}` }, { status: 404 });
      },
    });

    const root = mkdtempSync(join(tmpdir(), "todos-cloud-move-"));
    tempRoots.push(root);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const moved = await runCli(
        ["--json", "move", TASK_ID, "--to-project", PROJECT_B, "--to-list", "list-b"],
        root,
        baseUrl,
      );
      expect(moved).toMatchObject({ exitCode: 0, stderr: "" });
      const movedTask = JSON.parse(moved.stdout);
      // Task keeps its id, lands in project B and its task list.
      expect(movedTask).toMatchObject({
        id: TASK_ID,
        project_id: PROJECT_B,
        task_list_id: LIST_B,
      });

      // The PATCH carried the re-parent fields the server needs.
      const patch = requests.find((r) => r.method === "PATCH" && r.path === `/v1/tasks/${TASK_ID}`);
      expect(patch?.body).toMatchObject({ project_id: PROJECT_B, task_list_id: LIST_B });

      // It is gone from A and present in B.
      const inA = await runCli(["--json", "list", "--project", PROJECT_A], root, baseUrl);
      expect(JSON.parse(inA.stdout)).toEqual([]);
      const inB = await runCli(["--json", "list", "--project", PROJECT_B], root, baseUrl);
      expect(JSON.parse(inB.stdout)).toEqual([expect.objectContaining({ id: TASK_ID })]);
    } finally {
      server.stop(true);
    }
  });

  test("update --project re-parents the task instead of silently no-op'ing", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    let task: Record<string, unknown> = {
      id: TASK_ID,
      short_id: "APRJ-2",
      title: "Reparent via update",
      status: "pending",
      priority: "medium",
      project_id: PROJECT_A,
      task_list_id: LIST_A,
      version: 1,
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    };
    const projects = [
      projectRecord(PROJECT_A, "Project A", "project-a"),
      projectRecord(PROJECT_B, "Project B", "project-b"),
    ];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = ["POST", "PATCH", "PUT"].includes(request.method) ? await request.json() : undefined;
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === `/v1/tasks/${TASK_ID}` && request.method === "GET") {
          return Response.json({ task });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}` && (request.method === "PATCH" || request.method === "PUT")) {
          task = { ...task, ...(body as object), version: (task.version as number) + 1 };
          return Response.json({ task });
        }
        if (url.pathname === "/v1/projects" && request.method === "GET") {
          return Response.json({ projects, count: projects.length });
        }
        return Response.json({ error: `no route for ${request.method} ${url.pathname}` }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-update-project-"));
    tempRoots.push(root);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const updated = await runCli(["--json", "update", TASK_ID, "--project", PROJECT_B], root, baseUrl);
      expect(updated).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(updated.stdout)).toMatchObject({ id: TASK_ID, project_id: PROJECT_B });
      const patch = requests.find((r) => r.method === "PATCH" && r.path === `/v1/tasks/${TASK_ID}`);
      // The re-parent field is actually sent, and the old (project-scoped) list is detached.
      expect(patch?.body).toMatchObject({ project_id: PROJECT_B, task_list_id: null });
    } finally {
      server.stop(true);
    }
  });
});
