import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_API_KEY = "hasna_todos_test_key";
const PLAN_ID = "77777777-7777-4777-8777-777777777777";
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

  test("fails closed when an older cloud server has no plan delete route", async () => {
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
      expect(result.stderr).toContain("upgrade the server before retrying");
      expect(result.stdout).toBe("");
    } finally {
      server.stop(true);
    }
  });
});
