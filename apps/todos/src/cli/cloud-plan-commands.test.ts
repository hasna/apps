import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliverTodosApiKeyViaDisk } from "../testing.js";
import {
  planProjectLinkReceiptId,
  planProjectLinkResultDigest,
  planProjectLinkRollbackReceiptId,
} from "../lib/plan-project-link-contract.js";

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_API_KEY = "hasna_todos_test_key";
const PLAN_ID = "77777777-7777-4777-8777-777777777777";
/**
 * PATCH failures whose body the CLI must surface verbatim.
 *
 * 401 and 403 are deliberately NOT here. The @hasna/contracts transport cancels
 * an authentication failure's response body without reading it, so there is
 * nothing to echo: a body returned alongside a rejected credential is the one
 * place a server can reflect credential material back, and it would land in
 * stderr, in the `--json` envelope, and in every log that captures them. The
 * refusal is still exact — see the 401 case below, which asserts the authority
 * and the credential SOURCE are named instead.
 */
const PLAN_PATCH_FAILURES = [
  { status: 400, error: "invalid plan status" },
  { status: 405, error: `method PATCH not allowed on /v1/plans/${PLAN_ID}` },
  { status: 404, error: "plan not found" },
  { status: 503, error: "temporarily unavailable" },
] as const;
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

describe("cloud CLI plan commands", () => {
  test("creates a plan in the cloud dataset and reads it back by id and list", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    let plan: Record<string, unknown> | null = null;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = ["POST", "PATCH"].includes(request.method) ? await request.json() : undefined;
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === "/v1/plans" && request.method === "POST") {
          plan = {
            id: PLAN_ID,
            slug: "codila-cli-control",
            name: "Codila CLI control",
            description: "Private CLI release plan",
            status: "active",
            project_id: null,
            created_at: "2026-07-16T00:00:00.000Z",
            updated_at: "2026-07-16T00:00:00.000Z",
            ...(body as object),
          };
          return Response.json({ plan }, { status: 201 });
        }
        if (url.pathname === "/v1/plans" && request.method === "GET") {
          return Response.json({ plans: plan ? [plan] : [], count: plan ? 1 : 0 });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "GET") {
          return plan ? Response.json({ plan }) : Response.json({ error: "not found" }, { status: 404 });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "PATCH") {
          plan = plan ? { ...plan, ...(body as object) } : null;
          return plan ? Response.json({ plan }) : Response.json({ error: "not found" }, { status: 404 });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "DELETE") {
          plan = null;
          return Response.json({ deleted: true, id: PLAN_ID });
        }
        if (url.pathname === "/v1/tasks" && request.method === "GET") {
          return Response.json({ tasks: [], count: 0 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-plans-"));
    tempRoots.push(root);
    try {
      const created = await runCli(
        ["--json", "plans", "--add", "Codila CLI control", "--slug", "codila-cli-control", "--description", "Private CLI release plan"],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(created).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(created.stdout)).toMatchObject({ id: PLAN_ID, slug: "codila-cli-control" });

      const shown = await runCli(["--json", "plans", "--show", PLAN_ID], root, `http://127.0.0.1:${server.port}`);
      expect(shown).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(shown.stdout)).toMatchObject({ plan: { id: PLAN_ID }, tasks: [] });

      const listed = await runCli(["--json", "plans"], root, `http://127.0.0.1:${server.port}`);
      expect(listed).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(listed.stdout)).toEqual([expect.objectContaining({ id: PLAN_ID })]);
      const completed = await runCli(["--json", "plans", "--complete", PLAN_ID], root, `http://127.0.0.1:${server.port}`);
      expect(completed).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(completed.stdout)).toMatchObject({ id: PLAN_ID, status: "completed" });

      const deleted = await runCli(["--json", "plans", "--delete", PLAN_ID], root, `http://127.0.0.1:${server.port}`);
      expect(deleted).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(deleted.stdout)).toEqual({ deleted: true });
      expect(requests[0]).toMatchObject({
        method: "POST",
        path: "/v1/plans",
        body: {
          name: "Codila CLI control",
          slug: "codila-cli-control",
          description: "Private CLI release plan",
        },
      });
      expect(requests.at(-3)).toMatchObject({ method: "PATCH", path: `/v1/plans/${PLAN_ID}`, body: { status: "completed" } });
      expect(requests.at(-1)).toMatchObject({ method: "DELETE", path: `/v1/plans/${PLAN_ID}` });
    } finally {
      server.stop(true);
    }
  });

  test("completes a readable hosted plan when generic plan PATCH is unavailable", async () => {
    const missingPlanId = "88888888-8888-4888-8888-888888888888";
    const requests: Array<{
      method: string;
      path: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    let patchFailure: { status: number; error: string } | null = null;
    let plan = {
      id: PLAN_ID,
      slug: "hosted-closure",
      name: "Hosted closure",
      description: "Existing hosted plan",
      status: "active",
      project_id: "project-hosted",
      task_list_id: null,
      agent_id: "closure-agent",
      created_at: "2026-08-08T20:00:00.000Z",
      updated_at: "2026-08-08T20:00:00.000Z",
    };
    const tasks = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        short_id: "CLOSE-1",
        title: "Root task",
        status: "completed",
        plan_id: PLAN_ID,
        parent_id: null,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        short_id: "CLOSE-2",
        title: "Child task",
        status: "completed",
        plan_id: PLAN_ID,
        parent_id: "11111111-1111-4111-8111-111111111111",
      },
    ];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = ["POST", "PATCH"].includes(request.method) ? await request.json() : undefined;
        requests.push({
          method: request.method,
          path: url.pathname,
          authorization: request.headers.get("authorization"),
          body,
        });
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "GET") {
          return Response.json({ plan });
        }
        if (url.pathname === `/v1/plans/${missingPlanId}` && request.method === "GET") {
          return Response.json({ error: "plan not found" }, { status: 404 });
        }
        if (url.pathname === "/v1/plans" && request.method === "GET") {
          return Response.json({ plans: [plan], count: 1, total: 1 });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "PATCH") {
          if (patchFailure) {
            return Response.json({ error: patchFailure.error }, { status: patchFailure.status });
          }
          return Response.json({ error: "unknown /v1 resource: plans" }, { status: 404 });
        }
        if (url.pathname === "/v1/import" && request.method === "POST") {
          const completion = (body as {
            planCompletions?: Array<{
              id: string;
              expected_updated_at: string;
              status: "completed";
            }>;
          }).planCompletions?.[0];
          if (
            !completion
            || completion.id !== PLAN_ID
            || completion.status !== "completed"
            || completion.expected_updated_at !== plan.updated_at
          ) {
            return Response.json({ error: "expected one exact plan completion" }, { status: 409 });
          }
          plan = {
            ...plan,
            status: "completed",
            updated_at: "2026-08-08T20:00:00.002Z",
          };
          return Response.json({
            result: { inserted: 0, updated: 1, deleted: 0, skipped: 0, errors: [] },
            received: 1,
            planCompletions: [{
              id: PLAN_ID,
              status: "completed",
              expected_updated_at: completion.expected_updated_at,
              result_updated_at: plan.updated_at,
              applied: true,
            }],
          });
        }
        if (url.pathname === "/v1/tasks" && request.method === "GET") {
          return Response.json({ tasks, count: tasks.length, total: tasks.length });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-plan-complete-fallback-"));
    tempRoots.push(root);
    try {
      const shownBefore = await runCli(
        ["--json", "plans", "--show", PLAN_ID],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(shownBefore).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(shownBefore.stdout)).toMatchObject({
        plan: { id: PLAN_ID, status: "active" },
        tasks: [
          { id: tasks[0]!.id, status: "completed", plan_id: PLAN_ID },
          { id: tasks[1]!.id, status: "completed", plan_id: PLAN_ID },
        ],
      });

      const completed = await runCli(
        ["--json", "plans", "--complete", PLAN_ID],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(completed).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(completed.stdout)).toMatchObject({ id: PLAN_ID, status: "completed" });

      const shownAfter = await runCli(
        ["--json", "plans", "--show", PLAN_ID],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(shownAfter).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(shownAfter.stdout)).toMatchObject({
        plan: { id: PLAN_ID, status: "completed" },
        tasks: [
          { id: tasks[0]!.id, status: "completed", plan_id: PLAN_ID },
          { id: tasks[1]!.id, status: "completed", plan_id: PLAN_ID },
        ],
      });

      expect(requests).toContainEqual(expect.objectContaining({
        method: "PATCH",
        path: `/v1/plans/${PLAN_ID}`,
        authorization: `Bearer ${TEST_API_KEY}`,
        body: { status: "completed" },
      }));
      expect(requests).toContainEqual(expect.objectContaining({
        method: "POST",
        path: "/v1/import",
        authorization: `Bearer ${TEST_API_KEY}`,
        body: expect.objectContaining({
          planCompletions: [expect.objectContaining({
            id: PLAN_ID,
            status: "completed",
            expected_updated_at: "2026-08-08T20:00:00.000Z",
          })],
        }),
      }));
      const importRequest = requests.find((request) => request.path === "/v1/import");
      expect(Object.keys(importRequest?.body as Record<string, unknown>).sort()).toEqual([
        "planCompletions",
        "source",
      ]);
      expect(requests.filter((request) => request.path === "/v1/import")).toHaveLength(1);
    } finally {
      server.stop(true);
    }
  });

  test("does not import when the requested hosted plan is missing", async () => {
    const missingPlanId = "88888888-8888-4888-8888-888888888888";
    const requests: Array<{ method: string; path: string }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push({ method: request.method, path: url.pathname });
        if (url.pathname === `/v1/plans/${missingPlanId}` && request.method === "GET") {
          return Response.json({ error: "plan not found" }, { status: 404 });
        }
        if (url.pathname === "/v1/plans" && request.method === "GET") {
          return Response.json({ plans: [], count: 0, total: 0 });
        }
        return Response.json({ error: "mutation must not run" }, { status: 500 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-plan-complete-missing-"));
    tempRoots.push(root);
    try {
      const missing = await runCli(
        ["--json", "plans", "--complete", missingPlanId],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr).toContain(`Plan not found: ${missingPlanId}`);
      expect(requests.filter((request) => request.path === "/v1/import")).toHaveLength(0);
    } finally {
      server.stop(true);
    }
  });

  test.each(PLAN_PATCH_FAILURES)(
    "does not import when hosted plan PATCH returns $status: $error",
    async (failure) => {
      const requests: Array<{ method: string; path: string }> = [];
      const plan = {
        id: PLAN_ID,
        slug: "hosted-closure",
        name: "Hosted closure",
        description: "Existing hosted plan",
        status: "active",
        project_id: "project-hosted",
        task_list_id: null,
        agent_id: "closure-agent",
        created_at: "2026-08-08T20:00:00.000Z",
        updated_at: "2026-08-08T20:00:00.000Z",
      };
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          const url = new URL(request.url);
          requests.push({ method: request.method, path: url.pathname });
          if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "GET") {
            return Response.json({ plan });
          }
          if (url.pathname === "/v1/plans" && request.method === "GET") {
            return Response.json({ plans: [plan], count: 1, total: 1 });
          }
          if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "PATCH") {
            return Response.json({ error: failure.error }, { status: failure.status });
          }
          return Response.json({ error: "mutation must not run" }, { status: 500 });
        },
      });
      const root = mkdtempSync(join(tmpdir(), `todos-cloud-plan-complete-patch-${failure.status}-`));
      tempRoots.push(root);
      try {
        const rejected = await runCli(
          ["--json", "plans", "--complete", PLAN_ID],
          root,
          `http://127.0.0.1:${server.port}`,
        );
        expect(rejected.exitCode).toBe(1);
        expect(rejected.stderr).toContain(failure.error);
        expect(requests.filter((request) => request.path === "/v1/import")).toHaveLength(0);
      } finally {
        server.stop(true);
      }
    },
  );

  test("a 401 on the plan PATCH fails closed and names the credential, not the authority's body", async () => {
    const requests: Array<{ method: string; path: string }> = [];
    const plan = {
      id: PLAN_ID,
      slug: "hosted-closure",
      name: "Hosted closure",
      description: "Existing hosted plan",
      status: "active",
      project_id: "project-hosted",
      task_list_id: null,
      agent_id: "closure-agent",
      created_at: "2026-08-08T20:00:00.000Z",
      updated_at: "2026-08-08T20:00:00.000Z",
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push({ method: request.method, path: url.pathname });
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "GET") return Response.json({ plan });
        if (url.pathname === "/v1/plans" && request.method === "GET") {
          return Response.json({ plans: [plan], count: 1, total: 1 });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "PATCH") {
          // A hostile-shaped diagnostic body: exactly what must never be echoed.
          return Response.json({ error: "unauthorized: key hasna_todos_leaked" }, { status: 401 });
        }
        return Response.json({ error: "mutation must not run" }, { status: 500 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-plan-complete-patch-401-"));
    tempRoots.push(root);
    try {
      const rejected = await runCli(["--json", "plans", "--complete", PLAN_ID], root, `http://127.0.0.1:${server.port}`);
      expect(rejected.exitCode).toBe(1);
      expect(rejected.stderr).toContain("REMOTE_API_UNAUTHORIZED");
      expect(rejected.stderr).toContain("HASNA_TODOS_API_KEY");
      // The body is never read, so nothing it contained can reach a log.
      expect(rejected.stderr).not.toContain("hasna_todos_leaked");
      expect(rejected.stdout).not.toContain("hasna_todos_leaked");
      // And it still fails CLOSED: no compatibility import is attempted.
      expect(requests.filter((request) => request.path === "/v1/import")).toHaveLength(0);
    } finally {
      server.stop(true);
    }
  });

  test("fails closed when an equal-clock writer changes protected plan fields before fallback completion", async () => {
    const observedUpdatedAt = "2099-08-08T20:00:00.000Z";
    const equalClock = "2099-08-08T20:00:00.001Z";
    let plan = {
      id: PLAN_ID,
      slug: "hosted-closure",
      name: "Observed name",
      description: "Observed description",
      status: "active",
      project_id: "project-observed",
      task_list_id: "task-list-observed",
      agent_id: "agent-observed",
      created_at: "2026-08-08T20:00:00.000Z",
      updated_at: observedUpdatedAt,
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "GET") {
          return Response.json({ plan });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "PATCH") {
          return Response.json({ error: "unknown /v1 resource: plans" }, { status: 404 });
        }
        if (url.pathname === "/v1/import" && request.method === "POST") {
          const body = await request.json() as {
            plans?: Array<typeof plan>;
            planCompletions?: Array<{
              id: string;
              expected_updated_at: string;
              status: "completed";
            }>;
          };
          const completion = body.planCompletions?.[0];
          if (completion) {
            plan = {
              ...plan,
              name: "Concurrent name",
              description: "Concurrent description",
              project_id: "project-concurrent",
              task_list_id: "task-list-concurrent",
              agent_id: "agent-concurrent",
              updated_at: equalClock,
            };
            return Response.json({
              error: `Plan revision conflict: expected ${completion.expected_updated_at}, current ${plan.updated_at}`,
              code: "PLAN_REVISION_CONFLICT",
              conflict: true,
            }, { status: 409 });
          }

          // Legacy unsafe behavior: a full-plan writer changes protected fields
          // at the candidate clock, then the equal-clock completion snapshot is
          // accepted and overwrites them. The pre-fix client follows this branch
          // and falsely reports success because status-only readback passes.
          const imported = body.plans?.[0];
          if (!imported) return Response.json({ error: "missing completion" }, { status: 400 });
          plan = {
            ...plan,
            name: "Concurrent name",
            description: "Concurrent description",
            project_id: "project-concurrent",
            task_list_id: "task-list-concurrent",
            agent_id: "agent-concurrent",
            updated_at: imported.updated_at,
          };
          plan = { ...plan, ...imported };
          return Response.json({
            result: { inserted: 0, updated: 1, deleted: 0, skipped: 0, errors: [] },
            received: 1,
          });
        }
        if (url.pathname === "/v1/tasks" && request.method === "GET") {
          return Response.json({ tasks: [], count: 0, total: 0 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-plan-complete-conflict-"));
    tempRoots.push(root);
    try {
      const completed = await runCli(
        ["--json", "plans", "--complete", PLAN_ID],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(completed.exitCode).toBe(1);
      expect(completed.stderr).toContain("Plan revision conflict");
      expect(plan).toMatchObject({
        status: "active",
        name: "Concurrent name",
        description: "Concurrent description",
        project_id: "project-concurrent",
        task_list_id: "task-list-concurrent",
        agent_id: "agent-concurrent",
        updated_at: equalClock,
      });
    } finally {
      server.stop(true);
    }
  });

  test("fails closed when the legacy import route cannot perform atomic plan completion", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const plan = {
      id: PLAN_ID,
      slug: "legacy-import",
      name: "Legacy import",
      description: "Must remain active",
      status: "active",
      project_id: null,
      task_list_id: null,
      agent_id: null,
      created_at: "2026-08-08T20:00:00.000Z",
      updated_at: "2026-08-08T20:00:00.000Z",
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() : undefined;
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "GET") {
          return Response.json({ plan });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "PATCH") {
          return Response.json({ error: "unknown /v1 resource: plans" }, { status: 404 });
        }
        if (url.pathname === "/v1/import" && request.method === "POST") {
          return Response.json({
            error: "empty snapshot: provide at least one record array (tasks/projects/plans/...)",
          }, { status: 400 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-plan-complete-legacy-import-"));
    tempRoots.push(root);
    try {
      const completed = await runCli(
        ["--json", "plans", "--complete", PLAN_ID],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(completed.exitCode).toBe(1);
      expect(completed.stderr).toContain("empty snapshot");
      expect(plan.status).toBe("active");
      const importRequest = requests.find((request) => request.path === "/v1/import");
      expect(importRequest?.body).toMatchObject({
        planCompletions: [{
          id: PLAN_ID,
          expected_updated_at: plan.updated_at,
          status: "completed",
        }],
      });
      expect((importRequest?.body as { plans?: unknown }).plans).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("rejects completed-status readback when a protected plan field changed", async () => {
    let plan = {
      id: PLAN_ID,
      slug: "readback-guard",
      name: "Observed name",
      description: "Observed description",
      status: "active",
      project_id: null,
      task_list_id: null,
      agent_id: null,
      created_at: "2026-08-08T20:00:00.000Z",
      updated_at: "2026-08-08T20:00:00.000Z",
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "GET") {
          return Response.json({ plan });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "PATCH") {
          return Response.json({ error: "unknown /v1 resource: plans" }, { status: 404 });
        }
        if (url.pathname === "/v1/import" && request.method === "POST") {
          const expectedUpdatedAt = plan.updated_at;
          plan = {
            ...plan,
            status: "completed",
            name: "Unexpected concurrent name",
            updated_at: "2026-08-08T20:00:00.002Z",
          };
          return Response.json({
            result: { inserted: 0, updated: 1, deleted: 0, skipped: 0, errors: [] },
            received: 1,
            planCompletions: [{
              id: PLAN_ID,
              status: "completed",
              expected_updated_at: expectedUpdatedAt,
              result_updated_at: plan.updated_at,
              applied: true,
            }],
          });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-plan-complete-readback-guard-"));
    tempRoots.push(root);
    try {
      const completed = await runCli(
        ["--json", "plans", "--complete", PLAN_ID],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(completed.exitCode).toBe(1);
      expect(completed.stderr).toContain(
        "REMOTE_PLAN_COMPLETION_CONFLICT: /v1/import completion changed protected plan field name",
      );
      expect(plan).toMatchObject({
        status: "completed",
        name: "Unexpected concurrent name",
      });
    } finally {
      server.stop(true);
    }
  });

  test("shows every nested plan task in authority order without duplicates", async () => {
    const plan = {
      id: PLAN_ID,
      slug: "nested-delivery",
      name: "Nested delivery",
      description: null,
      status: "active",
      project_id: null,
      created_at: "2026-07-23T00:00:00.000Z",
      updated_at: "2026-07-23T00:00:00.000Z",
    };
    const tasks = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        short_id: "PLAN-1",
        title: "Root",
        plan_id: PLAN_ID,
        parent_id: null,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        short_id: "PLAN-2",
        title: "Child",
        plan_id: PLAN_ID,
        parent_id: "11111111-1111-4111-8111-111111111111",
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        short_id: "PLAN-3",
        title: "Grandchild",
        plan_id: PLAN_ID,
        parent_id: "22222222-2222-4222-8222-222222222222",
      },
    ];
    let taskQuery: URLSearchParams | null = null;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "GET") {
          return Response.json({ plan });
        }
        if (url.pathname === "/v1/tasks" && request.method === "GET") {
          taskQuery = new URLSearchParams(url.searchParams);
          const planTasks = tasks.filter((task) => task.plan_id === url.searchParams.get("plan_id"));
          const visibleTasks = url.searchParams.get("include_subtasks") === "true"
            ? planTasks
            : planTasks.filter((task) => task.parent_id === null);
          return Response.json({ tasks: visibleTasks, count: visibleTasks.length });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-plans-nested-"));
    tempRoots.push(root);
    try {
      const shown = await runCli(
        ["--json", "plans", "--show", PLAN_ID],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(shown).toMatchObject({ exitCode: 0, stderr: "" });
      const shownTasks = (JSON.parse(shown.stdout) as { tasks: Array<{ id: string }> }).tasks;
      expect(shownTasks.map((task) => task.id)).toEqual(tasks.map((task) => task.id));
      expect(new Set(shownTasks.map((task) => task.id)).size).toBe(tasks.length);
      expect(Object.fromEntries(taskQuery ?? [])).toMatchObject({
        plan_id: PLAN_ID,
        include_subtasks: "true",
      });
    } finally {
      server.stop(true);
    }
  });

  test("exhausts paged plan tasks without admitting tasks from another plan", async () => {
    const plan = {
      id: PLAN_ID,
      slug: "paged-delivery",
      name: "Paged delivery",
      description: null,
      status: "active",
      project_id: null,
      created_at: "2026-08-09T00:00:00.000Z",
      updated_at: "2026-08-09T00:00:00.000Z",
    };
    const roots = Array.from({ length: 71 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      short_id: `PLAN-${index + 1}`,
      title: `Root ${index + 1}`,
      plan_id: PLAN_ID,
      parent_id: null,
    }));
    const child = {
      id: "20000000-0000-4000-8000-000000000001",
      short_id: "PLAN-CHILD",
      title: "Existing child",
      plan_id: PLAN_ID,
      parent_id: roots[0]!.id,
    };
    const newlyLinked = {
      id: "30000000-0000-4000-8000-000000000001",
      short_id: "PLAN-NEW",
      title: "Newly linked root",
      plan_id: PLAN_ID,
      parent_id: null,
    };
    const unrelated = {
      id: "40000000-0000-4000-8000-000000000001",
      short_id: "OTHER-1",
      title: "Different plan",
      plan_id: "88888888-8888-4888-8888-888888888888",
      parent_id: null,
    };
    const tasks = [...roots, child, newlyLinked, unrelated];
    const taskQueries: URLSearchParams[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "GET") {
          return Response.json({ plan });
        }
        if (url.pathname === "/v1/tasks" && request.method === "GET") {
          taskQueries.push(new URLSearchParams(url.searchParams));
          const planTasks = tasks.filter((task) => task.plan_id === url.searchParams.get("plan_id"));
          const visibleTasks = url.searchParams.get("include_subtasks") === "true"
            ? planTasks
            : planTasks.filter((task) => task.parent_id === null);
          const offset = Number(url.searchParams.get("offset") ?? "0");
          const page = visibleTasks.slice(offset, offset + 72);
          return Response.json({ tasks: page, count: page.length, total: visibleTasks.length });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-plans-paged-"));
    tempRoots.push(root);
    try {
      const shown = await runCli(
        ["--json", "plans", "--show", PLAN_ID],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(shown).toMatchObject({ exitCode: 0, stderr: "" });
      const shownTasks = (JSON.parse(shown.stdout) as { tasks: Array<{ id: string }> }).tasks;
      const shownIds = shownTasks.map((task) => task.id);
      expect(shownIds).toContain(newlyLinked.id);
      expect(shownIds).toContain(child.id);
      expect(shownIds).not.toContain(unrelated.id);
      expect(shownTasks).toHaveLength(73);
      expect(new Set(shownIds).size).toBe(shownTasks.length);
      expect(taskQueries).toHaveLength(2);
      expect(Object.fromEntries(taskQueries[0]!)).toMatchObject({
        plan_id: PLAN_ID,
        include_subtasks: "true",
      });
      expect(Object.fromEntries(taskQueries[1]!)).toMatchObject({
        plan_id: PLAN_ID,
        include_subtasks: "true",
        offset: "72",
      });
    } finally {
      server.stop(true);
    }
  });

  test("fails closed when hosted plan tasks include a task from another plan", async () => {
    const plan = {
      id: PLAN_ID,
      slug: "foreign-plan-row",
      name: "Foreign plan row",
      description: null,
      status: "active",
      project_id: null,
      created_at: "2026-08-09T00:00:00.000Z",
      updated_at: "2026-08-09T00:00:00.000Z",
    };
    const foreignTask = {
      id: "40000000-0000-4000-8000-000000000001",
      short_id: "OTHER-1",
      title: "Different plan",
      plan_id: "88888888-8888-4888-8888-888888888888",
      parent_id: null,
    };
    const taskQueries: URLSearchParams[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "GET") {
          return Response.json({ plan });
        }
        if (url.pathname === "/v1/tasks" && request.method === "GET") {
          taskQueries.push(new URLSearchParams(url.searchParams));
          return Response.json({ tasks: [foreignTask], count: 1, total: 1 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-plans-foreign-row-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--json", "plans", "--show", PLAN_ID],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("REMOTE_PLAN_TASK_LIST_INCOMPLETE");
      expect(result.stderr).toContain(foreignTask.id);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: expect.stringContaining("REMOTE_PLAN_TASK_LIST_INCOMPLETE"),
      });
      expect(taskQueries).toHaveLength(1);
      expect(Object.fromEntries(taskQueries[0]!)).toMatchObject({
        plan_id: PLAN_ID,
        include_subtasks: "true",
      });
    } finally {
      server.stop(true);
    }
  });

  test("plans, applies, and rolls back guarded project linkage through the remote authority", async () => {
    const projectId = "88888888-8888-4888-8888-888888888888";
    const idempotencyKey = "cli-link-fixture";
    const receiptId = planProjectLinkReceiptId(idempotencyKey);
    const rollbackReceiptId = planProjectLinkRollbackReceiptId(receiptId);
    const requests: Array<{ method: string; path: string; query: string; body?: unknown }> = [];
    let plan = {
      id: PLAN_ID,
      slug: "link-existing-plan",
      name: "Link existing plan",
      description: null,
      status: "active" as const,
      project_id: null as string | null,
      task_list_id: null,
      agent_id: null,
      created_at: "2026-08-07T00:00:00.000Z",
      updated_at: "2026-08-07T00:01:00.000Z",
    };
    const project = {
      id: projectId,
      name: "Target project",
      path: "/workspace/target-project",
      description: null,
      task_list_id: null,
      task_prefix: null,
      task_counter: 0,
      machine_paths: [],
      metadata: {},
      created_at: "2026-08-07T00:00:00.000Z",
      updated_at: "2026-08-07T00:02:00.000Z",
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() : undefined;
        requests.push({ method: request.method, path: url.pathname, query: url.search, body });
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "GET") {
          return Response.json({ plan });
        }
        if (url.pathname === "/v1/projects" && request.method === "GET") {
          return Response.json({ projects: [project], count: 1 });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}/project-link` && request.method === "GET") {
          return Response.json({ mode: "plan", action: "would_link", plan, project, tasks: [], receipt: null });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}/project-link` && request.method === "POST") {
          plan = { ...plan, project_id: project.id, updated_at: "2026-08-07T00:03:00.000Z" };
          return Response.json({
            mode: "apply",
            action: "linked",
            plan,
            project,
            tasks: [],
            receipt: {
              schema_version: "todos.plan-project-link.v1",
              receipt_id: receiptId,
              idempotency_key: idempotencyKey,
              plan_id: plan.id,
              project_id: project.id,
              prior_plan_project_id: null,
              prior_task_project_ids: {},
              task_ids: [],
              task_count: 0,
              result_plan_revision: plan.updated_at,
              result_digest: planProjectLinkResultDigest(plan, []),
              rollback_supported: true,
              created_at: plan.updated_at,
            },
          }, { status: 201 });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}/project-link/rollback` && request.method === "POST") {
          plan = { ...plan, project_id: null, updated_at: "2026-08-07T00:04:00.000Z" };
          return Response.json({
            schema_version: "todos.plan-project-link.v1",
            action: "restored",
            plan,
            tasks: [],
            accepted_receipt_id: receiptId,
            rollback_receipt_id: rollbackReceiptId,
            restored_at: plan.updated_at,
          });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-plan-project-link-"));
    tempRoots.push(root);
    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const planned = await runCli(
        ["--json", "plans", "--link-project", PLAN_ID, "--to-project", projectId],
        root,
        baseUrl,
      );
      expect(planned).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(planned.stdout)).toMatchObject({ action: "would_link", project: { id: projectId } });

      const applied = await runCli(
        [
          "--json", "plans", "--link-project", PLAN_ID, "--to-project", projectId,
          "--apply", "--idempotency-key", idempotencyKey,
        ],
        root,
        baseUrl,
      );
      expect(applied).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(applied.stdout)).toMatchObject({ action: "linked", receipt: { receipt_id: receiptId } });

      const rolledBack = await runCli(
        [
          "--json", "plans", "--rollback-project-link", PLAN_ID, "--to-project", projectId,
          "--receipt", receiptId,
        ],
        root,
        baseUrl,
      );
      expect(rolledBack).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(rolledBack.stdout)).toMatchObject({ action: "restored", rollback_receipt_id: rollbackReceiptId });

      const linkCalls = requests.filter((entry) => entry.path.includes("/project-link"));
      expect(linkCalls).toEqual([
        { method: "GET", path: `/v1/plans/${PLAN_ID}/project-link`, query: `?project_id=${projectId}`, body: undefined },
        { method: "GET", path: `/v1/plans/${PLAN_ID}/project-link`, query: `?project_id=${projectId}`, body: undefined },
        {
          method: "POST",
          path: `/v1/plans/${PLAN_ID}/project-link`,
          query: "",
          body: {
            project_id: projectId,
            expected_plan_revision: "2026-08-07T00:01:00.000Z",
            expected_project_revision: project.updated_at,
            idempotency_key: idempotencyKey,
          },
        },
        {
          method: "POST",
          path: `/v1/plans/${PLAN_ID}/project-link/rollback`,
          query: "",
          body: {
            project_id: projectId,
            receipt_id: receiptId,
            expected_plan_revision: "2026-08-07T00:03:00.000Z",
          },
        },
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("fails closed when a stale authority returns an ordinary plan for the project-link route", async () => {
    const projectId = "88888888-8888-4888-8888-888888888888";
    const plan = {
      id: PLAN_ID,
      slug: "link-existing-plan",
      name: "Link existing plan",
      description: null,
      status: "active" as const,
      project_id: null,
      task_list_id: null,
      agent_id: null,
      created_at: "2026-08-07T00:00:00.000Z",
      updated_at: "2026-08-07T00:01:00.000Z",
    };
    const project = {
      id: projectId,
      name: "Target project",
      path: "/workspace/target-project",
      description: null,
      task_list_id: null,
      task_prefix: null,
      task_counter: 0,
      created_at: "2026-08-07T00:00:00.000Z",
      updated_at: "2026-08-07T00:02:00.000Z",
    };
    const requests: Array<{ method: string; path: string }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push({ method: request.method, path: url.pathname });
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "GET") {
          return Response.json({ plan });
        }
        if (url.pathname === "/v1/projects" && request.method === "GET") {
          return Response.json({ projects: [project], count: 1 });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}/project-link` && request.method === "GET") {
          return Response.json(plan);
        }
        return Response.json({ error: "mutation must not run" }, { status: 500 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-plan-project-link-stale-route-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--json", "plans", "--link-project", PLAN_ID, "--to-project", projectId],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("REMOTE_API_INCOMPATIBLE");
      expect(result.stderr).toContain("todos.plan-project-link.v1 plan response");
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: expect.stringContaining("REMOTE_API_INCOMPATIBLE"),
      });
      expect(JSON.parse(result.stdout).error).toContain("todos.plan-project-link.v1 plan response");
      expect(requests).toEqual([
        { method: "GET", path: `/v1/plans/${PLAN_ID}` },
        { method: "GET", path: "/v1/projects" },
        { method: "GET", path: `/v1/plans/${PLAN_ID}/project-link` },
      ]);
    } finally {
      server.stop(true);
    }
  });

  test.each([
    ["--complete", "Duplicate plan"],
    ["--complete", "duplicate-slug"],
    ["--complete", "12345678"],
    ["--delete", "Duplicate plan"],
    ["--delete", "duplicate-slug"],
    ["--delete", "12345678"],
  ])("fails closed before %s when cloud ref %s is ambiguous", async (operation, ref) => {
    const requests: Array<{ method: string; path: string }> = [];
    const duplicate = (id: string) => ({
      id,
      slug: "duplicate-slug",
      name: "Duplicate plan",
      status: "active",
      project_id: null,
      created_at: "2026-07-16T00:00:00.000Z",
      updated_at: "2026-07-16T00:00:00.000Z",
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push({ method: request.method, path: url.pathname });
        if (url.pathname === "/v1/plans" && request.method === "GET") {
          return Response.json({
            plans: [
              duplicate("12345678-1111-4111-8111-111111111111"),
              duplicate("12345678-2222-4222-8222-222222222222"),
            ],
            count: 2,
          });
        }
        return Response.json({ error: "mutation must not run" }, { status: 500 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-plans-ambiguous-"));
    tempRoots.push(root);
    try {
      const result = await runCli(["--json", "plans", operation, ref], root, `http://127.0.0.1:${server.port}`);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Plan reference is ambiguous");
      expect(requests).toEqual([{ method: "GET", path: "/v1/plans" }]);
    } finally {
      server.stop(true);
    }
  });

  test("treats a resource DELETE 404 as a normal not-found result", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "GET") {
          return Response.json({ plan: { id: PLAN_ID, slug: "legacy", name: "Legacy", status: "active" } });
        }
        if (url.pathname === `/v1/plans/${PLAN_ID}` && request.method === "DELETE") {
          return Response.json({ error: "not found" }, { status: 404 });
        }
        return Response.json({ error: "unexpected" }, { status: 500 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-cloud-plans-old-server-"));
    tempRoots.push(root);
    try {
      const result = await runCli(["--json", "plans", "--delete", PLAN_ID], root, `http://127.0.0.1:${server.port}`);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({ deleted: false });
    } finally {
      server.stop(true);
    }
  });
});
