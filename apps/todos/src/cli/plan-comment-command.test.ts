import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

/**
 * Regression: `todos comment <plan-id>` returned 404 "task not found" because
 * plans have no comment surface — the comment verb only resolved task
 * references and the write path only accepted task ids. Measured by multiple
 * skills-plan lanes on 2026-08-18: plan-level outcomes could not be recorded on
 * the plan row.
 *
 * The fix gives plans a comment surface end to end (local sqlite, /v1 API, and
 * the CLI): `todos comment <plan-id|plan-slug> "text"` records on the plan row,
 * and `todos plans --show <plan-id>` lists those comments. Task comments are
 * untouched — the task surface stays authoritative for task rows.
 */

const REPO_ROOT = join(import.meta.dir, "../..");
const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

type CliResult = { stdout: string; stderr: string; exitCode: number };

async function runLocalCli(args: string[], dbPath: string, homeRoot: string): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: localRoutingTestEnv({
      HOME: homeRoot,
      TMPDIR: homeRoot,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function runCloudCli(args: string[], root: string, baseUrl: string): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: localRoutingTestEnv({
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "todos.db"),
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_API_URL: baseUrl,
      HASNA_TODOS_API_KEY: "throwaway",
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("todos comment on a plan (local)", () => {
  test("records a comment on the plan row by full plan UUID", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-plan-comment-local-"));
    tempRoots.push(root);
    const dbPath = join(root, "todos.db");

    const created = await runLocalCli(["plans", "--add", "Skills rollout", "--slug", "skills-rollout", "--json"], dbPath, root);
    expect(created.exitCode).toBe(0);
    const planId = (JSON.parse(created.stdout) as { id: string }).id;

    const commented = await runLocalCli(
      ["--agent", "backlog-bugs-execute", "comment", planId, "published 12 skills to the fleet"],
      dbPath,
      root,
    );
    expect(commented.exitCode).toBe(0);
    expect(commented.stderr).not.toContain("task not found");
    expect(commented.stdout).toContain("Comment added.");

    const shown = await runLocalCli(["plans", "--show", planId, "--json"], dbPath, root);
    expect(shown.exitCode).toBe(0);
    const body = JSON.parse(shown.stdout) as {
      plan: { id: string };
      comments: Array<{ plan_id: string; content: string; agent_id: string | null }>;
    };
    expect(body.plan.id).toBe(planId);
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]!.plan_id).toBe(planId);
    expect(body.comments[0]!.content).toBe("published 12 skills to the fleet");
    expect(body.comments[0]!.agent_id).toBe("backlog-bugs-execute");
  }, 30000);
  test("records a comment on the plan row by plan slug", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-plan-comment-slug-"));
    tempRoots.push(root);
    const dbPath = join(root, "todos.db");

    await runLocalCli(["plans", "--add", "Slugged plan", "--slug", "slugged-plan", "--json"], dbPath, root);

    const commented = await runLocalCli(
      ["--agent", "backlog-bugs-execute", "comment", "slugged-plan", "outcome via slug"],
      dbPath,
      root,
    );
    expect(commented.exitCode).toBe(0);
    expect(commented.stdout).toContain("Comment added.");
  }, 30000);
  test("task comments keep working unchanged", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-plan-comment-task-"));
    tempRoots.push(root);
    const dbPath = join(root, "todos.db");

    const added = await runLocalCli(
      ["--agent", "backlog-bugs-execute", "add", "task that must still accept comments", "--json"],
      dbPath,
      root,
    );
    expect(added.exitCode).toBe(0);
    const taskId = (JSON.parse(added.stdout) as { id: string }).id;

    const commented = await runLocalCli(
      ["--agent", "backlog-bugs-execute", "comment", taskId, "task-level note"],
      dbPath,
      root,
    );
    expect(commented.exitCode).toBe(0);
    expect(commented.stdout).toContain("Comment added.");

    const shown = await runLocalCli(["show", taskId, "--json"], dbPath, root);
    expect(shown.exitCode).toBe(0);
    const body = JSON.parse(shown.stdout) as { comments: Array<{ content: string }> };
    expect(body.comments.map((c) => c.content)).toContain("task-level note");
  }, 30000);
  test("an id that resolves as neither task nor plan still fails with a not-found error", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-plan-comment-missing-"));
    tempRoots.push(root);
    const dbPath = join(root, "todos.db");

    const commented = await runLocalCli(
      ["--agent", "backlog-bugs-execute", "comment", "ffffffff-ffff-4fff-8fff-ffffffffffff", "nowhere"],
      dbPath,
      root,
    );
    expect(commented.exitCode).toBe(1);
    expect(commented.stderr).toMatch(/task not found|no task or plan/i);
  }, 30000);
});

describe("todos comment on a plan (cloud /v1)", () => {
  test("falls back from the task comment 404 to the plan comment surface", async () => {
    const requests: Array<{ method: string; path: string }> = [];
    const planComments: Array<Record<string, unknown>> = [];
    const planFixture = {
      id: PLAN_ID,
      slug: "cloud-plan",
      project_id: null,
      task_list_id: null,
      agent_id: null,
      name: "Cloud plan",
      description: null,
      status: "active",
      created_at: "2026-08-18T10:00:00.000Z",
      updated_at: "2026-08-18T10:00:00.000Z",
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() as Record<string, unknown> : undefined;
        requests.push({ method: request.method, path: url.pathname });
        // The measured bug: the task comment path 404s on a plan id.
        if (url.pathname === `/v1/tasks/${PLAN_ID}/comments` && request.method === "POST") {
          return Response.json({ error: "task not found" }, { status: 404 });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "GET") {
          return Response.json({ plan: planFixture });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}/comments` && request.method === "POST") {
          const comment = {
            id: `plan-comment-${planComments.length + 1}`,
            plan_id: PLAN_ID,
            agent_id: body?.agent_id ?? null,
            session_id: body?.session_id ?? null,
            content: body?.content,
            type: body?.type ?? "comment",
            progress_pct: body?.progress_pct ?? null,
            created_at: "2026-08-18T10:05:00.000Z",
          };
          planComments.push(comment);
          return Response.json({ comment }, { status: 201 });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}/comments` && request.method === "GET") {
          return Response.json({ comments: planComments, count: planComments.length });
        }
        if (url.pathname === "/v1/tasks" && request.method === "GET") {
          return Response.json({ tasks: [], count: 0, total: 0 });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}` && request.method === "GET") {
          return Response.json({
            task: { id: TASK_ID, short_id: null, title: "task", status: "pending", priority: "medium", version: 1 },
          });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}/comments` && request.method === "POST") {
          return Response.json({
            comment: {
              id: "task-comment-1",
              task_id: TASK_ID,
              agent_id: body?.agent_id ?? null,
              session_id: null,
              content: body?.content,
              type: "comment",
              progress_pct: null,
              created_at: "2026-08-18T10:06:00.000Z",
            },
          }, { status: 201 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-plan-comment-cloud-"));
    tempRoots.push(root);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const commented = await runCloudCli(
        ["--agent", "backlog-bugs-execute", "comment", PLAN_ID, "cloud plan outcome"],
        root,
        baseUrl,
      );
      expect(commented.exitCode).toBe(0);
      expect(commented.stderr).not.toContain("task not found");
      expect(commented.stdout).toContain("Comment added.");

      expect(requests).toEqual([
        { method: "POST", path: `/v1/tasks/${PLAN_ID}/comments` },
        { method: "GET", path: `/v1/plans/${PLAN_ID}` },
        { method: "POST", path: `/v1/plans/${PLAN_ID}/comments` },
      ]);
      expect(planComments).toHaveLength(1);
      expect(planComments[0]!.content).toBe("cloud plan outcome");

      // The plan comment surface is readable over the cloud API too.
      const shown = await runCloudCli(["plans", "--show", PLAN_ID, "--json"], root, baseUrl);
      expect(shown.exitCode).toBe(0);
      const body = JSON.parse(shown.stdout) as { plan: { id: string }; comments: Array<{ content: string }> };
      expect(body.plan.id).toBe(PLAN_ID);
      expect(body.comments.map((c) => c.content)).toContain("cloud plan outcome");
    } finally {
      server.stop();
    }
  }, 30000);
  test("task comments still go straight to the task comment route without a 404 detour", async () => {
    const requests: Array<{ method: string; path: string }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        requests.push({ method: request.method, path: url.pathname });
        if (url.pathname === `/v1/tasks/${TASK_ID}` && request.method === "GET") {
          return Response.json({
            task: { id: TASK_ID, short_id: null, title: "task", status: "pending", priority: "medium", version: 1 },
          });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}/comments` && request.method === "POST") {
          return Response.json({
            comment: {
              id: "task-comment-1",
              task_id: TASK_ID,
              agent_id: null,
              session_id: null,
              content: "task note",
              type: "comment",
              progress_pct: null,
              created_at: "2026-08-18T10:06:00.000Z",
            },
          }, { status: 201 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-task-comment-cloud-"));
    tempRoots.push(root);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const commented = await runCloudCli(
        ["--agent", "backlog-bugs-execute", "comment", TASK_ID, "task note"],
        root,
        baseUrl,
      );
      expect(commented.exitCode).toBe(0);
      expect(commented.stdout).toContain("Comment added.");
      // No plan lookup happened: the task comment route answered on the first try.
      expect(requests).toEqual([
        { method: "POST", path: `/v1/tasks/${TASK_ID}/comments` },
      ]);
    } finally {
      server.stop();
    }
  });
});
