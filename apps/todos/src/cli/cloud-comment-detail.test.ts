import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const TASK_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_ID = "22222222-2222-4222-8222-222222222222";
const TEST_API_KEY = "hasna_todos_test_key";
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function runCli(args: string[], root: string, baseUrl: string, extraEnv: Record<string, string> = {}) {
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
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

function taskFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    short_id: null,
    project_id: null,
    parent_id: null,
    plan_id: null,
    task_list_id: "missing-local-list",
    title: "Cloud short id regression",
    description: null,
    status: "pending",
    priority: "medium",
    agent_id: null,
    assigned_to: null,
    session_id: null,
    working_dir: null,
    tags: [],
    metadata: {},
    version: 1,
    locked_by: null,
    locked_at: null,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
    started_at: null,
    completed_at: null,
    due_at: null,
    estimated_minutes: null,
    actual_minutes: null,
    requires_approval: false,
    approved_by: null,
    approved_at: null,
    recurrence_rule: null,
    recurrence_parent_id: null,
    spawns_template_id: null,
    confidence: null,
    reason: null,
    spawned_from_session: null,
    assigned_by: null,
    assigned_from_project: null,
    task_type: null,
    cost_tokens: 0,
    cost_usd: 0,
    delegated_from: null,
    delegation_depth: 0,
    retry_count: 0,
    max_retries: 0,
    retry_after: null,
    sla_minutes: null,
    runner_id: null,
    runner_started_at: null,
    runner_completed_at: null,
    current_step: null,
    total_steps: null,
    machine_id: null,
    synced_at: null,
    archived_at: null,
    ...overrides,
  };
}

describe("cloud task detail comments", () => {
  test("cloud add seeds the local id index so its printed short prefix starts and comments", async () => {
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    const comments: Record<string, unknown>[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() as Record<string, unknown> : undefined;
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === "/v1/tasks" && request.method === "POST") {
          return Response.json({ task: taskFixture({ title: body?.title }) }, { status: 201 });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}/start` && request.method === "POST") {
          return Response.json({ task: taskFixture({ status: "in_progress", locked_by: body?.agent_id ?? null }) });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}/comments` && request.method === "POST") {
          const comment = {
            id: `comment-${comments.length + 1}`,
            task_id: TASK_ID,
            agent_id: body?.agent_id ?? null,
            session_id: body?.session_id ?? null,
            content: body?.content,
            type: body?.type ?? "comment",
            progress_pct: body?.progress_pct ?? null,
            created_at: "2026-07-10T00:01:00.000Z",
          };
          comments.push(comment);
          return Response.json({ comment }, { status: 201 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-created-short-id-"));
    tempRoots.push(root);
    const shortId = TASK_ID.slice(0, 8);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const add = await runCli(["add", "Cloud short id regression"], root, baseUrl);
      expect(add).toMatchObject({ exitCode: 0, stderr: "" });
      expect(add.stdout).toContain(shortId);

      const alternateDb = { TODOS_DB_PATH: join(root, "different-local-mirror.db") };
      const started = await runCli(["start", shortId], root, baseUrl, alternateDb);
      expect(started).toMatchObject({ exitCode: 0, stderr: "" });

      const commented = await runCli(["comment", shortId, "started from printed prefix"], root, baseUrl, alternateDb);
      expect(commented).toMatchObject({ exitCode: 0, stderr: "" });

      expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
        "POST /v1/tasks",
        `POST /v1/tasks/${TASK_ID}/start`,
        `POST /v1/tasks/${TASK_ID}/comments`,
      ]);
      expect(comments).toHaveLength(1);
      expect(comments[0]).toMatchObject({ task_id: TASK_ID, content: "started from printed prefix" });
    } finally {
      server.stop(true);
    }
  });

  test("add --parent carries the exact parent id through the self-hosted create request", async () => {
    let createBody: Record<string, unknown> | null = null;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/v1/tasks" && request.method === "POST") {
          createBody = await request.json() as Record<string, unknown>;
          return Response.json({
            task: {
              id: TASK_ID,
              title: createBody["title"],
              parent_id: createBody["parent_id"] ?? null,
              status: "pending",
              priority: "medium",
              tags: [],
              version: 1,
              created_at: "2026-07-10T00:00:00.000Z",
              updated_at: "2026-07-10T00:00:00.000Z",
            },
          }, { status: 201 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-parent-create-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--json", "add", "Cloud child", "--parent", PARENT_ID],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(createBody).toMatchObject({ title: "Cloud child", parent_id: PARENT_ID });
      expect(JSON.parse(result.stdout)).toMatchObject({ id: TASK_ID, parent_id: PARENT_ID });
    } finally {
      server.stop(true);
    }
  });

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

      comments.push({
        id: "comment-controls",
        task_id: TASK_ID,
        agent_id: "agent\u001b[31m",
        session_id: null,
        content: "visible\u001b]52;c;forged\u0007next\nline",
        type: "comment",
        progress_pct: null,
        created_at: "2026-07-10T00:03:00.000Z",
      });
      for (const command of ["show", "inspect"] as const) {
        const result = await runCli([command, TASK_ID], root, baseUrl);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).not.toContain("\u001b]52");
        expect(result.stdout).not.toContain("\u0007");
        expect(result.stdout).toContain("\\x1b]52");
        expect(result.stdout).toContain("\\x07next\\nline");
      }

      while (comments.length < 150) {
        const index = comments.length;
        comments.push({
          id: `legacy-${index}`,
          task_id: TASK_ID,
          agent_id: null,
          session_id: null,
          content: `legacy ${index}`,
          type: "comment",
          progress_pct: null,
          created_at: `2026-07-10T01:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
        });
      }
      const legacy = await runCli(["show", TASK_ID], root, baseUrl);
      expect(legacy.exitCode).toBe(0);
      expect(legacy.stdout).toContain("older comments omitted until the server is upgraded");

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
