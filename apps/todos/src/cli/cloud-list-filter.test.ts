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
