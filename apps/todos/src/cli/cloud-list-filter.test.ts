import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  test("imports a canonical exported checklist through cloud HTTP and never opens local storage", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() : undefined;
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === "/v1/templates" && request.method === "POST") {
          return Response.json({ template: { id: "template-1", ...(body as object), tasks: [] } }, { status: 201 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-template-import-"));
    tempRoots.push(root);
    const exportPath = join(root, "monthly-accounting.json");
    writeFileSync(exportPath, JSON.stringify({
      name: "Monthly accounting",
      title_pattern: "Monthly accounting {month}",
      description: null,
      priority: "medium",
      tags: ["accounting"],
      variables: [],
      project_id: null,
      plan_id: null,
      metadata: {},
      tasks: [{ position: 0, title_pattern: "Collect statements", description: null, priority: "high", tags: [], task_type: null, condition: null, include_template_id: null, depends_on_positions: [], metadata: {} }],
    }));
    try {
      const result = await runCli(["--json", "template-import", exportPath], root, `http://127.0.0.1:${server.port}`);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(requests).toEqual([expect.objectContaining({ method: "POST", path: "/v1/templates", body: expect.objectContaining({ description: null, tasks: [expect.objectContaining({ position: 0, depends_on_positions: [] })] }) })]);
      expect(existsSync(join(root, "todos.db"))).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("uses and deletes a reusable checklist through cloud HTTP without a local fallback", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    let taskNumber = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() : undefined;
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === "/v1/templates/template-1" && request.method === "GET") {
          return Response.json({ template: {
            id: "template-1", name: "Monthly", title_pattern: "Monthly {month}", description: null,
            priority: "medium", tags: ["accounting"], variables: [], version: 1, project_id: PROJECT_ID, plan_id: null, metadata: {},
            tasks: [
              { id: "step-1", position: 0, title_pattern: "Collect {month}", description: null, priority: "medium", tags: [], depends_on_positions: [] },
              { id: "step-2", position: 1, title_pattern: "Reconcile {month}", description: null, priority: "high", tags: [], depends_on_positions: [0] },
            ],
          } });
        }
        if (url.pathname === "/v1/tasks" && request.method === "POST") {
          taskNumber += 1;
          return Response.json({ task: { id: `task-${taskNumber}`, ...(body as object), status: "pending" } }, { status: 201 });
        }
        if (url.pathname === "/v1/tasks/task-2/dependencies" && request.method === "POST") return Response.json({ dependency: { task_id: "task-2", depends_on: "task-1" } }, { status: 201 });
        if (url.pathname === "/v1/templates/template-1" && request.method === "DELETE") return Response.json({ deleted: true });
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-template-use-"));
    tempRoots.push(root);
    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      expect(await runCli(["--json", "templates", "--use", "template-1", "--var", "month=May"], root, baseUrl)).toMatchObject({ exitCode: 0, stderr: "" });
      expect(await runCli(["--json", "templates", "--delete", "template-1"], root, baseUrl)).toMatchObject({ exitCode: 0, stderr: "" });
      expect(requests).toEqual(expect.arrayContaining([
        expect.objectContaining({ method: "POST", path: "/v1/tasks", body: expect.objectContaining({ title: "Collect May", project_id: PROJECT_ID }) }),
        expect.objectContaining({ method: "POST", path: "/v1/tasks", body: expect.objectContaining({ title: "Reconcile May", project_id: PROJECT_ID }) }),
        expect.objectContaining({ method: "POST", path: "/v1/tasks/task-2/dependencies", body: { depends_on: "task-1" } }),
        expect.objectContaining({ method: "DELETE", path: "/v1/templates/template-1" }),
      ]));
      expect(existsSync(join(root, "todos.db"))).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("applies remote template variable defaults, conditions, and composition without local storage", async () => {
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    let taskNumber = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() as Record<string, unknown> : undefined;
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === "/v1/templates/template-parent" && request.method === "GET") {
          return Response.json({ template: {
            id: "template-parent", name: "Parent", title_pattern: "Parent", description: null,
            priority: "medium", tags: [], version: 1, project_id: PROJECT_ID, plan_id: "plan-parent", metadata: {},
            variables: [
              { name: "month", required: false, default: "May" },
              { name: "company", required: true },
              { name: "include_receipts", required: false, default: "false" },
            ],
            tasks: [
              { id: "step-statements", position: 0, title_pattern: "Statements {company} {month}", description: null, priority: "medium", tags: [], task_type: null, condition: null, include_template_id: null, depends_on_positions: [], metadata: {} },
              { id: "step-receipts", position: 1, title_pattern: "Receipts", description: null, priority: "medium", tags: [], task_type: null, condition: "{include_receipts}", include_template_id: null, depends_on_positions: [], metadata: {} },
              { id: "step-include", position: 2, title_pattern: "ignored", description: null, priority: "medium", tags: [], task_type: null, condition: null, include_template_id: "template-child", depends_on_positions: [], metadata: {} },
              { id: "step-include-again", position: 3, title_pattern: "ignored", description: null, priority: "medium", tags: [], task_type: null, condition: null, include_template_id: "template-child", depends_on_positions: [], metadata: {} },
              { id: "step-reconcile", position: 4, title_pattern: "Reconcile {month}", description: null, priority: "high", tags: [], task_type: "reconciliation", condition: null, include_template_id: null, depends_on_positions: [0, 2, 3], metadata: { source: "template" } },
            ],
          } });
        }
        if (url.pathname === "/v1/templates/template-child" && request.method === "GET") {
          return Response.json({ template: {
            id: "template-child", name: "Child", title_pattern: "Child", description: null,
            priority: "medium", tags: [], variables: [{ name: "company", required: true }], version: 1, project_id: null, plan_id: null, metadata: {},
            tasks: [{ id: "step-invoice", position: 0, title_pattern: "Invoice {company} {month}", description: null, priority: "medium", tags: [], task_type: null, condition: null, include_template_id: null, depends_on_positions: [], metadata: {} }],
          } });
        }
        if (url.pathname === "/v1/tasks" && request.method === "POST") {
          taskNumber += 1;
          return Response.json({ task: { id: `task-${taskNumber}`, ...(body ?? {}), status: "pending" } }, { status: 201 });
        }
        if (url.pathname === "/v1/tasks/task-4/dependencies" && request.method === "POST") return Response.json({ dependency: body }, { status: 201 });
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-template-semantics-"));
    tempRoots.push(root);
    try {
      const missingRequired = await runCli(
        ["--json", "templates", "--use", "template-parent"],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(missingRequired.exitCode).not.toBe(0);
      expect(missingRequired.stderr).toContain("Missing required template variable(s): company");
      expect(requests.filter((entry) => entry.method === "POST" && entry.path === "/v1/tasks")).toHaveLength(0);
      requests.length = 0;
      const result = await runCli(
        ["--json", "templates", "--use", "template-parent", "--var", "company=Beep"],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      const taskBodies = requests.filter((entry) => entry.method === "POST" && entry.path === "/v1/tasks").map((entry) => entry.body);
      expect(taskBodies).toEqual([
        expect.objectContaining({ title: "Statements Beep May", project_id: PROJECT_ID, plan_id: "plan-parent" }),
        expect.objectContaining({ title: "Invoice Beep May", project_id: PROJECT_ID }),
        expect.objectContaining({ title: "Invoice Beep May", project_id: PROJECT_ID }),
        expect.objectContaining({ title: "Reconcile May", plan_id: "plan-parent", task_type: "reconciliation", metadata: { source: "template" } }),
      ]);
      expect(requests).toEqual(expect.arrayContaining([
        expect.objectContaining({ method: "POST", path: "/v1/tasks/task-4/dependencies", body: { depends_on: "task-1" } }),
        expect.objectContaining({ method: "POST", path: "/v1/tasks/task-4/dependencies", body: { depends_on: "task-2" } }),
        expect.objectContaining({ method: "POST", path: "/v1/tasks/task-4/dependencies", body: { depends_on: "task-3" } }),
      ]));
      expect(existsSync(join(root, "todos.db"))).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("applies zero-step template defaults and CLI overrides through cloud HTTP", async () => {
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() as Record<string, unknown> : undefined;
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === "/v1/templates/template-single" && request.method === "GET") {
          return Response.json({ template: {
            id: "template-single", name: "Single", title_pattern: "Original {month}", description: "Original description", priority: "medium", tags: ["accounting"],
            variables: [{ name: "month", required: false, default: "May" }], version: 1, project_id: PROJECT_ID, plan_id: "plan-1", metadata: { source: "monthly-template" }, tasks: [],
          } });
        }
        if (url.pathname === "/v1/tasks" && request.method === "POST") {
          return Response.json({ task: { id: "task-single", ...(body ?? {}), status: "pending" } }, { status: 201 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-template-single-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--json", "templates", "--use", "template-single", "--title", "Close {month}", "--description", "Closing {month}", "--priority", "critical"],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(requests).toEqual(expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Close May",
            description: "Closing May",
            priority: "critical",
            tags: ["accounting"],
            project_id: PROJECT_ID,
            plan_id: "plan-1",
            metadata: { source: "monthly-template" },
          },
        }),
      ]));
      expect(existsSync(join(root, "todos.db"))).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("previews a cloud template through HTTP with canonical variables and no local fallback", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() : undefined;
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === "/v1/templates/template-preview" && request.method === "GET") {
          return Response.json({ template: {
            id: "template-preview",
            name: "Monthly accounting",
            title_pattern: "Monthly accounting {period}",
            description: "Canonical preview",
            priority: "medium",
            tags: ["accounting"],
            variables: [
              { name: "period", required: false, default: "2026-07" },
              { name: "include_receipts", required: false, default: "false" },
            ],
            project_id: PROJECT_ID,
            plan_id: "plan-1",
            metadata: { source: "fixture" },
            tasks: [
              { id: "step-1", position: 0, title_pattern: "Collect {period}", description: "Statements {period}", priority: "high", tags: ["bank"], task_type: "collection", condition: null, include_template_id: null, depends_on_positions: [], metadata: {} },
              { id: "step-2", position: 1, title_pattern: "Receipts {period}", description: "", priority: "medium", tags: [], task_type: null, condition: "{include_receipts}", include_template_id: null, depends_on_positions: [0], metadata: {} },
            ],
          } });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-template-preview-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--json", "template-preview", "template-preview", "--var", "period=2026-08"],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toEqual({
        template_id: "template-preview",
        template_name: "Monthly accounting",
        description: "Canonical preview",
        variables: [
          { name: "period", required: false, default: "2026-07" },
          { name: "include_receipts", required: false, default: "false" },
        ],
        resolved_variables: { period: "2026-08", include_receipts: "false" },
        tasks: [{
          position: 0,
          title: "Collect 2026-08",
          description: "Statements 2026-08",
          priority: "high",
          tags: ["bank"],
          task_type: "collection",
          depends_on_positions: [],
        }],
      });
      const includeReceipts = await runCli(
        ["--json", "template-preview", "template-preview", "--var", "period=2026-08", "--var", "include_receipts=true"],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(includeReceipts).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(includeReceipts.stdout).tasks).toEqual(expect.arrayContaining([
        expect.objectContaining({ position: 1, description: null }),
      ]));
      expect(requests).toEqual([
        { method: "GET", path: "/v1/templates/template-preview" },
        { method: "GET", path: "/v1/templates/template-preview" },
      ]);
      expect(existsSync(join(root, "todos.db"))).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("exports a cloud template through HTTP in the canonical import shape with no local fallback", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() : undefined;
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === "/v1/templates/template-export" && request.method === "GET") {
          return Response.json({ template: {
            id: "template-export",
            name: "Monthly accounting",
            title_pattern: "Monthly accounting {period}",
            description: null,
            priority: "high",
            tags: ["accounting"],
            variables: [{ name: "period", required: true }],
            project_id: PROJECT_ID,
            plan_id: "plan-1",
            metadata: { source: "fixture" },
            tasks: [{
              id: "step-1",
              position: 0,
              title_pattern: "Collect statements {period}",
              description: null,
              priority: "high",
              tags: ["bank"],
              task_type: "collection",
              condition: null,
              include_template_id: null,
              depends_on_positions: [],
              metadata: { evidence: "required" },
            }],
          } });
        }
        if (url.pathname === "/v1/templates" && request.method === "POST") {
          return Response.json({ template: { id: "template-imported", ...(body as object), tasks: [] } }, { status: 201 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-template-export-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["template-export", "template-export"],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      const exported = JSON.parse(result.stdout);
      expect(exported).toEqual({
        name: "Monthly accounting",
        title_pattern: "Monthly accounting {period}",
        description: null,
        priority: "high",
        tags: ["accounting"],
        variables: [{ name: "period", required: true }],
        project_id: PROJECT_ID,
        plan_id: "plan-1",
        metadata: { source: "fixture" },
        tasks: [{
          position: 0,
          title_pattern: "Collect statements {period}",
          description: null,
          priority: "high",
          tags: ["bank"],
          task_type: "collection",
          condition: null,
          include_template_id: null,
          depends_on_positions: [],
          metadata: { evidence: "required" },
        }],
      });
      const exportPath = join(root, "monthly-accounting.json");
      writeFileSync(exportPath, JSON.stringify(exported));
      const imported = await runCli(
        ["--json", "template-import", exportPath],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(imported).toMatchObject({ exitCode: 0, stderr: "" });
      expect(requests).toEqual([
        { method: "GET", path: "/v1/templates/template-export" },
        { method: "POST", path: "/v1/templates", body: exported },
      ]);
      expect(existsSync(join(root, "todos.db"))).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});
