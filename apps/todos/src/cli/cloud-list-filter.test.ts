import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_API_KEY = "hasna_todos_test_key";
const PROJECT_ID = "99999999-9999-4999-8999-999999999999";
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

describe("cloud CLI task-list filtering", () => {
  test.each([
    ["project-scoped slug", "release", true],
    ["exact UUID", LIST_ID, false],
    ["unique UUID prefix", "12345678", false],
  ])("resolves %s before sending the task filter", async (_label, ref, projectScoped) => {
    const seenTaskListFilters: Array<string | null> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/v1/task-lists") {
          expect(url.searchParams.get("project_id")).toBe(projectScoped ? PROJECT_ID : null);
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
        [...(projectScoped ? ["--project", PROJECT_ID] : []), "--json", "list", "--list", ref],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toEqual([
        expect.objectContaining({ id: TASK_ID, task_list_id: LIST_ID }),
      ]);
      expect(seenTaskListFilters).toEqual([LIST_ID]);
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
});
