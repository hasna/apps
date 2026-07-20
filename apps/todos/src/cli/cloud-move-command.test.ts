import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("cloud CLI move command", () => {
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
