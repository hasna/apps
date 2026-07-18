import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_API_KEY = "hasna_todos_test_key";
const PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const PROJECT_SLUG = "open-emails";
const PROJECT_PATH = "/workspace/hasna/opensource/open-emails";
const LIST_ID = "12345678-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
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

function taskList(id: string, slug: string) {
  return { id, project_id: PROJECT_ID, slug, name: slug };
}

function project(id = PROJECT_ID, name = "Open Emails", path = PROJECT_PATH) {
  return { id, name, path, task_list_id: "emails-canonical" };
}

describe("cloud CLI task-list filtering", () => {
  test.each([PROJECT_SLUG, "Open Emails", PROJECT_PATH])(
    "resolves project ref %s before every cloud lists operation",
    async (projectRef) => {
      for (const operation of ["list", "add", "delete"] as const) {
        const requests: Array<{ method: string; path: string; query: string; body?: unknown }> = [];
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            const url = new URL(request.url);
            const body = request.method === "POST" ? await request.json() : undefined;
            requests.push({ method: request.method, path: url.pathname, query: url.searchParams.toString(), body });
            if (url.pathname === "/v1/projects") return Response.json({ projects: [project()] });
            if (url.pathname === "/v1/task-lists" && request.method === "GET") {
              return Response.json({ task_lists: [taskList(LIST_ID, "release")] });
            }
            if (url.pathname === "/v1/task-lists" && request.method === "POST") {
              return Response.json({ task_list: { ...taskList(LIST_ID, "release"), ...(body as object) } }, { status: 201 });
            }
            if (url.pathname === `/v1/task-lists/${LIST_ID}` && request.method === "DELETE") {
              return Response.json({ deleted: true });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        });
        const root = mkdtempSync(join(tmpdir(), "todos-cloud-lists-project-ref-"));
        tempRoots.push(root);
        const operationArgs = operation === "add"
          ? ["--add", "Release", "--slug", "release"]
          : operation === "delete"
            ? ["--delete", "release"]
            : [];
        try {
          const result = await runCli(
            ["--project", projectRef, "--json", "lists", ...operationArgs],
            root,
            `http://127.0.0.1:${server.port}`,
          );
          expect(result).toMatchObject({ exitCode: 0, stderr: "" });
          expect(requests[0]).toMatchObject({ method: "GET", path: "/v1/projects" });
          if (operation === "add") {
            expect(requests[1]).toMatchObject({
              method: "POST",
              path: "/v1/task-lists",
              body: expect.objectContaining({ project_id: PROJECT_ID }),
            });
          } else {
            expect(requests[1]).toMatchObject({
              method: "GET",
              path: "/v1/task-lists",
              query: `project_id=${PROJECT_ID}`,
            });
          }
        } finally {
          server.stop(true);
        }
      }
    },
  );

  test.each([
    ["global project option", ["--project", PROJECT_SLUG, "--json", "add", "Cloud task", "--list", "release"]],
    ["add project option", ["--json", "add", "Cloud task", "--project", PROJECT_SLUG, "--list", "release"]],
  ])("resolves the project before cloud add scopes a task-list slug via %s", async (_label, args) => {
    const requests: Array<{ method: string; path: string; query: string; body?: unknown }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() : undefined;
        requests.push({ method: request.method, path: url.pathname, query: url.searchParams.toString(), body });
        if (url.pathname === "/v1/projects") return Response.json({ projects: [project()] });
        if (url.pathname === "/v1/task-lists") {
          expect(url.searchParams.get("project_id")).toBe(PROJECT_ID);
          return Response.json({ task_lists: [taskList(LIST_ID, "release")] });
        }
        if (url.pathname === "/v1/tasks" && request.method === "POST") {
          return Response.json({ task: { id: TASK_ID, ...(body as object) } }, { status: 201 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-add-project-filter-"));
    tempRoots.push(root);
    try {
      const result = await runCli(args, root, `http://127.0.0.1:${server.port}`);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toMatchObject({
        id: TASK_ID,
        project_id: PROJECT_ID,
        task_list_id: LIST_ID,
      });
      expect(requests.map((entry) => `${entry.method} ${entry.path}?${entry.query}`)).toEqual([
        "GET /v1/projects?",
        `GET /v1/task-lists?project_id=${PROJECT_ID}`,
        "POST /v1/tasks?",
      ]);
      expect(requests[2]!.body).toMatchObject({ project_id: PROJECT_ID, task_list_id: LIST_ID });
    } finally {
      server.stop(true);
    }
  });

  test("routes project-rename through one server-side atomic mutation", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() : undefined;
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === "/v1/projects") return Response.json({ projects: [project()] });
        if (url.pathname === `/v1/projects/${PROJECT_ID}/rename` && request.method === "POST") {
          return Response.json({
            project: { ...project(), name: "Emails Next", task_list_id: "emails-next" },
            task_lists_updated: 1,
          });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-project-rename-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--json", "project-rename", PROJECT_SLUG, "emails-next", "--name", "Emails Next"],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toMatchObject({
        project: { id: PROJECT_ID, name: "Emails Next", task_list_id: "emails-next" },
        task_lists_updated: 1,
      });
      expect(requests).toEqual([
        { method: "GET", path: "/v1/projects", body: undefined },
        { method: "POST", path: `/v1/projects/${PROJECT_ID}/rename`, body: { new_slug: "emails-next", name: "Emails Next" } },
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("project-rename preserves the server's stable conflict response", async () => {
    const methods: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        methods.push(`${request.method} ${url.pathname}`);
        if (url.pathname === "/v1/projects") return Response.json({ projects: [project()] });
        if (url.pathname === `/v1/projects/${PROJECT_ID}/rename` && request.method === "POST") {
          return Response.json({ error: "Task-list slug conflict", code: "TASK_LIST_SLUG_CONFLICT", conflict: true }, { status: 409 });
        }
        return Response.json({ error: "mutation must not run" }, { status: 500 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-project-rename-conflict-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--json", "project-rename", PROJECT_SLUG, "emails-next"],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("-> 409");
      expect(methods).toEqual(["GET /v1/projects", `POST /v1/projects/${PROJECT_ID}/rename`]);
    } finally {
      server.stop(true);
    }
  });

  test("project-rename performs no client-side rollback requests after response loss", async () => {
    const methods: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        methods.push(`${request.method} ${url.pathname}`);
        if (url.pathname === "/v1/projects") return Response.json({ projects: [project()] });
        if (url.pathname === `/v1/projects/${PROJECT_ID}/rename` && request.method === "POST") {
          return Response.json({ error: "response unavailable" }, { status: 503 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-project-rename-rollback-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--json", "project-rename", PROJECT_SLUG, "emails-next"],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("REMOTE_API_UNAVAILABLE");
      expect(methods).toEqual(["GET /v1/projects", `POST /v1/projects/${PROJECT_ID}/rename`]);
    } finally {
      server.stop(true);
    }
  });

  test.each([
    ["project-scoped slug", "release", PROJECT_SLUG],
    ["exact UUID", LIST_ID, false],
    ["unique UUID prefix", "12345678", false],
  ])("resolves %s before sending the task filter", async (_label, ref, projectRef) => {
    const seenTaskListFilters: Array<string | null> = [];
    let taskListRequests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/v1/projects") {
          return Response.json({ projects: [project()] });
        }
        if (url.pathname === "/v1/task-lists") {
          taskListRequests++;
          expect(url.searchParams.get("project_id")).toBe(projectRef ? PROJECT_ID : null);
          return Response.json({ task_lists: [taskList(LIST_ID, "release")] });
        }
        if (url.pathname === "/v1/tasks") {
          const taskListId = url.searchParams.get("task_list_id");
          seenTaskListFilters.push(taskListId);
          return Response.json({
            tasks: taskListId === LIST_ID
              ? [{ id: TASK_ID, task_list_id: LIST_ID, title: "Cloud list task", status: "pending", priority: "medium" }]
              : [],
          });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-list-filter-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        [...(projectRef ? ["--project", projectRef] : []), "--json", "list", "--list", ref],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toEqual([
        expect.objectContaining({ id: TASK_ID, task_list_id: LIST_ID }),
      ]);
      expect(seenTaskListFilters).toEqual([LIST_ID]);
      expect(taskListRequests).toBe(ref === LIST_ID ? 0 : 1);
    } finally {
      server.stop(true);
    }
  });

  test.each([
    ["exact UUID", PROJECT_ID],
    ["unique UUID prefix", "99999999"],
    ["canonical slug", PROJECT_SLUG],
    ["project task-list slug", "emails-canonical"],
    ["exact name", "Open Emails"],
    ["registered path", PROJECT_PATH],
    ["station-local repository path", "/home/hasna/workspace/hasna/opensource/open-emails"],
  ])("resolves the cloud project %s before the task-list scope", async (_label, projectRef) => {
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(`${url.pathname}?${url.searchParams.toString()}`);
        if (url.pathname === "/v1/projects") return Response.json({ projects: [project()] });
        if (url.pathname === "/v1/task-lists") {
          return Response.json({ task_lists: [taskList(LIST_ID, "release")] });
        }
        if (url.pathname === "/v1/tasks") return Response.json({ tasks: [] });
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-project-filter-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--project", projectRef, "--json", "list", "--list", "release"],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(requests).toEqual([
        "/v1/projects?",
        `/v1/task-lists?project_id=${PROJECT_ID}`,
        `/v1/tasks?status=pending%2Cin_progress&project_id=${PROJECT_ID}&task_list_id=${LIST_ID}`,
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("resolves --project-name before listing cloud tasks", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(`${url.pathname}?${url.searchParams.toString()}`);
        if (url.pathname === "/v1/projects") return Response.json({ projects: [project()] });
        if (url.pathname === "/v1/tasks") {
          return Response.json({
            tasks: url.searchParams.get("project_id") === PROJECT_ID
              ? [{ id: TASK_ID, project_id: PROJECT_ID, title: "Cloud project task", status: "pending", priority: "medium" }]
              : [],
          });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-project-name-filter-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--json", "list", "--all", "--project-name", PROJECT_SLUG],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toEqual([
        expect.objectContaining({ id: TASK_ID, project_id: PROJECT_ID }),
      ]);
      expect(requests).toEqual([
        "/v1/projects?",
        `/v1/tasks?project_id=${PROJECT_ID}`,
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("uses --project-name to scope a cloud task-list slug", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(`${url.pathname}?${url.searchParams.toString()}`);
        if (url.pathname === "/v1/projects") return Response.json({ projects: [project()] });
        if (url.pathname === "/v1/task-lists") {
          return Response.json({ task_lists: [taskList(LIST_ID, "release")] });
        }
        if (url.pathname === "/v1/tasks") return Response.json({ tasks: [] });
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-project-name-list-filter-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--json", "list", "--all", "--project-name", PROJECT_SLUG, "--list", "release"],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(requests).toEqual([
        "/v1/projects?",
        `/v1/task-lists?project_id=${PROJECT_ID}`,
        `/v1/tasks?project_id=${PROJECT_ID}&task_list_id=${LIST_ID}`,
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("fails a missing cloud --project-name before listing tasks", async () => {
    let taskRequests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/v1/projects") return Response.json({ projects: [project()] });
        if (url.pathname === "/v1/tasks") taskRequests++;
        return Response.json({ tasks: [] });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-project-name-filter-error-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--json", "list", "--project-name", "missing"],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Project not found");
      expect(taskRequests).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test.each([
    ["missing", [taskList(LIST_ID, "release")], "Task list not found"],
    [
      "shared",
      [taskList("aaaaaaaa-1111-4111-8111-111111111111", "shared"), taskList("aaaaaaaa-2222-4222-8222-222222222222", "shared")],
      "Task list reference is ambiguous",
    ],
    [
      "aaaaaaaa",
      [taskList("aaaaaaaa-1111-4111-8111-111111111111", "first"), taskList("aaaaaaaa-2222-4222-8222-222222222222", "second")],
      "Task list reference is ambiguous",
    ],
  ])("fails explicitly before listing tasks for ref %s", async (ref, lists, expectedError) => {
    let taskRequests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/v1/projects") return Response.json({ projects: [project()] });
        if (url.pathname === "/v1/task-lists") return Response.json({ task_lists: lists });
        if (url.pathname === "/v1/tasks") taskRequests++;
        return Response.json({ tasks: [] });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-list-filter-error-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--project", PROJECT_ID, "--json", "list", "--list", ref],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(expectedError);
      expect(taskRequests).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test.each([
    ["missing", [project()], "Project not found"],
    [
      "Shared",
      [project("aaaaaaaa-1111-4111-8111-111111111111", "Shared", "/one"), project("bbbbbbbb-2222-4222-8222-222222222222", "Shared", "/two")],
      "Project reference is ambiguous",
    ],
    [
      "aaaaaaaa",
      [project("aaaaaaaa-1111-4111-8111-111111111111", "First", "/one"), project("aaaaaaaa-2222-4222-8222-222222222222", "Second", "/two")],
      "Project reference is ambiguous",
    ],
  ])("fails explicitly before resolving a task list for project ref %s", async (projectRef, projects, expectedError) => {
    let taskListRequests = 0;
    let taskRequests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/v1/projects") return Response.json({ projects });
        if (url.pathname === "/v1/task-lists") taskListRequests++;
        if (url.pathname === "/v1/tasks") taskRequests++;
        return Response.json({ task_lists: [] });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-project-filter-error-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--project", projectRef, "--json", "list", "--list", "release"],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(expectedError);
      expect(taskListRequests).toBe(0);
      expect(taskRequests).toBe(0);
    } finally {
      server.stop(true);
    }
  });
});
