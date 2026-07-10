import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const TASK_ID = "11111111-1111-4111-8111-111111111111";
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

describe("cloud task detail comments", () => {
  test("comment -> persisted GET -> show/inspect round-trips ordered comments and redacts historical content", async () => {
    const comments: Array<Record<string, unknown>> = [];
    const requests: Array<{ method: string; path: string; authorized: boolean }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        requests.push({
          method: request.method,
          path: url.pathname,
          authorized: request.headers.get("authorization") === `Bearer ${TEST_API_KEY}`,
        });
        if (url.pathname === `/v1/tasks/${TASK_ID}` && request.method === "GET") {
          return Response.json({
            task: {
              id: TASK_ID,
              title: "Cloud comment regression",
              status: "in_progress",
              priority: "high",
              tags: [],
              version: 1,
              created_at: "2026-07-10T00:00:00.000Z",
              updated_at: "2026-07-10T00:00:00.000Z",
              comments: [{ id: "stale-task-envelope-comment" }],
            },
          });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}/comments` && request.method === "POST") {
          const body = await request.json() as Record<string, unknown>;
          const comment = {
            id: `comment-${comments.length + 1}`,
            task_id: TASK_ID,
            agent_id: null,
            session_id: null,
            content: body.content,
            type: body.type ?? "comment",
            progress_pct: body.progress_pct ?? null,
            created_at: `2026-07-10T00:0${comments.length + 1}:00.000Z`,
          };
          comments.push(comment);
          return Response.json({ comment }, { status: 201 });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}/comments` && request.method === "GET") {
          return Response.json({ comments, count: comments.length });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });

    const root = mkdtempSync(join(tmpdir(), "todos-cloud-comment-detail-"));
    tempRoots.push(root);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const first = await runCli(["comment", TASK_ID, "first persisted comment"], root, baseUrl);
      expect(first).toMatchObject({ exitCode: 0, stderr: "" });
      const second = await runCli(["comment", TASK_ID, "Bearer abcdefghijklmnop should redact"], root, baseUrl);
      expect(second).toMatchObject({ exitCode: 0, stderr: "" });

      for (const command of ["show", "inspect"] as const) {
        const result = await runCli(["--json", command, TASK_ID], root, baseUrl);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const task = JSON.parse(result.stdout);
        expect(task.comments).toHaveLength(2);
        expect(task.comments.map((comment: { id: string }) => comment.id)).toEqual(["comment-1", "comment-2"]);
        expect(task.comments[0]).toMatchObject({ task_id: TASK_ID, content: "first persisted comment" });
        expect(task.comments[1].content).toContain("[REDACTED]");
        expect(task.comments[1].content).not.toContain("abcdefghijklmnop");
      }

      expect(requests).toEqual(expect.arrayContaining([
        { method: "POST", path: `/v1/tasks/${TASK_ID}/comments`, authorized: true },
        { method: "GET", path: `/v1/tasks/${TASK_ID}/comments`, authorized: true },
      ]));
    } finally {
      server.stop(true);
    }
  });

  test("a missing cloud task does not issue a comments request", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push(new URL(request.url).pathname);
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-comment-missing-"));
    tempRoots.push(root);
    try {
      const result = await runCli(["--json", "show", TASK_ID], root, `http://127.0.0.1:${server.port}`);
      expect(result.exitCode).not.toBe(0);
      expect(requests).toEqual([`/v1/tasks/${TASK_ID}`]);
    } finally {
      server.stop(true);
    }
  });
});
