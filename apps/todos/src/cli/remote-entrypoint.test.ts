import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializeTodosCliAuthority,
  type TodosCliAuthorityInitialization,
} from "./stage-a.js";
import { resetTodosCloudClient } from "./cloud-router.js";

const REPO_ROOT = join(import.meta.dir, "../..");
const tempRoots: string[] = [];
let buildRoot: string | undefined;
let executable: string;

type CliResult = { exitCode: number; stdout: string; stderr: string };

async function buildCli(): Promise<string> {
  const ignoredBuildParent = join(REPO_ROOT, ".tmp");
  mkdirSync(ignoredBuildParent, { recursive: true });
  buildRoot = mkdtempSync(join(ignoredBuildParent, "remote-cli-entrypoint-"));
  const build = await Bun.build({
    entrypoints: [join(REPO_ROOT, "src/cli/index.tsx")],
    outdir: buildRoot,
    target: "bun",
    external: ["ink", "react", "chalk", "@modelcontextprotocol/sdk", "@hasna/contracts/client/storage"],
  });
  expect(build.success).toBe(true);
  expect(build.outputs).toHaveLength(1);
  return build.outputs[0]!.path;
}

async function runCli(executable: string, args: string[], env: Record<string, string>): Promise<CliResult> {
  const proc = Bun.spawn(["bun", executable, ...args], {
    cwd: REPO_ROOT,
    env: { ...env, NODE_PATH: join(REPO_ROOT, "node_modules") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

function expectNoLocalDatabase(root: string, explicitPath: string): void {
  expect(existsSync(explicitPath)).toBe(false);
  expect(existsSync(join(root, ".todos"))).toBe(false);
  expect(existsSync(join(root, ".hasna", "todos", "todos.db"))).toBe(false);
  expect(existsSync(join(root, ".hasna", "todos"))).toBe(false);
}

beforeAll(async () => {
  executable = await buildCli();
});

beforeEach(() => {
  resetTodosCloudClient();
});

afterEach(() => {
  resetTodosCloudClient();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

afterAll(() => {
  if (buildRoot) rmSync(buildRoot, { recursive: true, force: true });
});

describe("remote CLI entrypoint authority boundary", () => {
  test("selects HTTP before local-capable command modules initialize", () => {
    const result: TodosCliAuthorityInitialization = initializeTodosCliAuthority(
      ["--json", "status"],
      {
        HASNA_TODOS_STORAGE_MODE: "remote",
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      },
    );

    expect(result).toEqual({
      route: "remote-http",
      v1_base_url: "https://authority.invalid/v1",
    });
    expect(() => initializeTodosCliAuthority(
      ["task", "--json", "upsert", "--fingerprint", "fixture", "--title", "Fixture"],
      {
        HASNA_TODOS_STORAGE_MODE: "remote",
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      },
    )).not.toThrow();
  });

  test("built status command uses /v1 and never opens the local or Postgres adapter", async () => {
    const requests: Array<{ method: string; path: string; authorization: string | null }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push({
          method: request.method,
          path: url.pathname,
          authorization: request.headers.get("authorization"),
        });
        if (url.pathname === "/v1/stats") {
          return Response.json({ tasks: 0, projects: 0 });
        }
        if (url.pathname === "/v1/tasks") {
          return Response.json({ tasks: [], count: 0 });
        }
        return Response.json({ error: "route not present in fixture" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-remote-entrypoint-"));
    tempRoots.push(root);
    const localDbPath = join(root, "local-adapter-must-not-open", "todos.db");

    try {
      const result = await runCli(executable, ["--json", "status"], {
          PATH: process.env.PATH ?? "",
          BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
          HOME: root,
          TMPDIR: root,
          LANG: "C.UTF-8",
          TODOS_AUTO_PROJECT: "false",
          TODOS_DB_PATH: localDbPath,
          HASNA_TODOS_STORAGE_MODE: "remote",
          HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
          HASNA_TODOS_API_KEY: "fixture-remote-key",
      });

      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toMatchObject({
        source: "cloud",
        transport: "http-v1",
        authority: { v1_base_url: `http://127.0.0.1:${server.port}/v1`, local_fallback: false },
        total: 0,
      });
      expect(requests.some((request) => request.path === "/v1/stats")).toBe(true);
      expect(requests.some((request) => request.path === "/v1/tasks")).toBe(true);
      expect(requests.every((request) => request.authorization === "Bearer fixture-remote-key")).toBe(true);
      expect(existsSync(join(root, "local-adapter-must-not-open"))).toBe(false);
      expectNoLocalDatabase(root, localDbPath);

      for (const diagnostic of [["--json", "config"], ["--json", "storage", "status"]]) {
        const diagnosticResult = await runCli(executable, diagnostic, {
          PATH: process.env.PATH ?? "",
          BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
          HOME: root,
          TMPDIR: root,
          LANG: "C.UTF-8",
          TODOS_DB_PATH: localDbPath,
          HASNA_TODOS_STORAGE_MODE: "remote",
          HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
          HASNA_TODOS_API_KEY: "fixture-remote-key",
        });
        expect({ exitCode: diagnosticResult.exitCode, stderr: diagnosticResult.stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(() => JSON.parse(diagnosticResult.stdout)).not.toThrow();
        expectNoLocalDatabase(root, localDbPath);
      }

      const missingUrl = await runCli(executable, ["--json", "projects"], {
        PATH: process.env.PATH ?? "",
        BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
        HOME: root,
        TMPDIR: root,
        LANG: "C.UTF-8",
        TODOS_DB_PATH: localDbPath,
        HASNA_TODOS_STORAGE_MODE: "remote",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      });
      expect(missingUrl.exitCode).toBe(1);
      expect(missingUrl.stderr).toContain("REMOTE_API_URL_MISSING");
      expectNoLocalDatabase(root, localDbPath);

      const missingKey = await runCli(executable, ["--json", "projects"], {
        PATH: process.env.PATH ?? "",
        BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
        HOME: root,
        TMPDIR: root,
        LANG: "C.UTF-8",
        TODOS_DB_PATH: localDbPath,
        HASNA_TODOS_STORAGE_MODE: "remote",
        HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      });
      expect(missingKey.exitCode).toBe(1);
      expect(missingKey.stderr).toContain("REMOTE_API_KEY_MISSING");
      expectNoLocalDatabase(root, localDbPath);
    } finally {
      server.stop(true);
    }
  });

  test("built project/list/plan/task lifecycle stays on HTTP with a read-only TODOS_DB_PATH", async () => {
    const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
    const LIST_ID = "22222222-2222-4222-8222-222222222222";
    const PLAN_ID = "33333333-3333-4333-8333-333333333333";
    const TASK_IDS = [
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ];
    const now = "2026-07-18T00:00:00.000Z";
    const projects: Array<Record<string, unknown>> = [];
    const taskLists: Array<Record<string, unknown>> = [];
    const plans: Array<Record<string, unknown>> = [];
    const tasks: Array<Record<string, unknown>> = [];
    const requests: string[] = [];
    let nextTaskId = 0;

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const route = `${request.method} ${url.pathname}${url.search}`;
        requests.push(route);
        if (request.headers.get("authorization") !== "Bearer fixture-remote-key") {
          return Response.json({ error: "fixture auth required" }, { status: 401 });
        }
        const body = request.method === "GET" || request.method === "HEAD"
          ? {}
          : await request.json().catch(() => ({})) as Record<string, unknown>;
        const find = (items: Array<Record<string, unknown>>, id: string) =>
          items.find((item) => item.id === id);
        const remove = (items: Array<Record<string, unknown>>, id: string) => {
          const index = items.findIndex((item) => item.id === id);
          if (index < 0) return false;
          items.splice(index, 1);
          return true;
        };

        if (url.pathname === "/v1/stats" && request.method === "GET") {
          return Response.json({ tasks: tasks.length, tasks_all: tasks.length, projects: projects.length });
        }
        if (url.pathname === "/v1/projects") {
          if (request.method === "GET") return Response.json({ projects, count: projects.length });
          if (request.method === "POST") {
            const project = { id: PROJECT_ID, name: body.name, path: body.path, description: body.description ?? null, task_list_id: null, created_at: now, updated_at: now };
            projects.push(project);
            return Response.json({ project }, { status: 201 });
          }
        }
        const projectMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)$/);
        if (projectMatch) {
          const project = find(projects, projectMatch[1]!);
          if (!project) return Response.json({ error: "project not found" }, { status: 404 });
          if (request.method === "GET") return Response.json({ project });
          if (request.method === "PATCH") {
            Object.assign(project, body, { updated_at: now });
            return Response.json({ project });
          }
        }

        if (url.pathname === "/v1/task-lists") {
          if (request.method === "GET") {
            const projectId = url.searchParams.get("project_id");
            const items = projectId ? taskLists.filter((item) => item.project_id === projectId) : taskLists;
            return Response.json({ task_lists: items, count: items.length });
          }
          if (request.method === "POST") {
            const task_list = { id: LIST_ID, name: body.name, slug: body.slug ?? "work", description: body.description ?? null, project_id: body.project_id ?? null, metadata: {}, created_at: now, updated_at: now };
            taskLists.push(task_list);
            return Response.json({ task_list }, { status: 201 });
          }
        }
        const listMatch = url.pathname.match(/^\/v1\/task-lists\/([^/]+)$/);
        if (listMatch) {
          const task_list = find(taskLists, listMatch[1]!);
          if (!task_list) return Response.json({ error: "task list not found" }, { status: 404 });
          if (request.method === "GET") return Response.json({ task_list });
          if (request.method === "PATCH") {
            Object.assign(task_list, body, { updated_at: now });
            return Response.json({ task_list });
          }
          if (request.method === "DELETE") {
            remove(taskLists, listMatch[1]!);
            return Response.json({ deleted: true });
          }
        }

        if (url.pathname === "/v1/plans") {
          if (request.method === "GET") {
            const projectId = url.searchParams.get("project_id");
            const items = projectId ? plans.filter((item) => item.project_id === projectId) : plans;
            return Response.json({ plans: items, count: items.length });
          }
          if (request.method === "POST") {
            const plan = { id: PLAN_ID, name: body.name, slug: body.slug ?? "delivery", description: body.description ?? null, status: "active", project_id: body.project_id ?? null, task_list_id: null, created_at: now, updated_at: now };
            plans.push(plan);
            return Response.json({ plan }, { status: 201 });
          }
        }
        const planMatch = url.pathname.match(/^\/v1\/plans\/([^/]+)$/);
        if (planMatch) {
          const plan = find(plans, planMatch[1]!);
          if (!plan) return Response.json({ error: "plan not found" }, { status: 404 });
          if (request.method === "GET") return Response.json({ plan });
          if (request.method === "PATCH") {
            Object.assign(plan, body, { updated_at: now });
            return Response.json({ plan });
          }
          if (request.method === "DELETE") {
            remove(plans, planMatch[1]!);
            return Response.json({ deleted: true });
          }
        }

        if (url.pathname === "/v1/tasks/next/claim" && request.method === "POST") {
          const task = tasks.find((item) => item.status === "pending") ?? null;
          if (task) Object.assign(task, { status: "in_progress", assigned_to: body.agent_id, updated_at: now });
          return Response.json({ task });
        }
        if (url.pathname === "/v1/next" && request.method === "GET") {
          const task = tasks.find((item) => item.status === "pending") ?? null;
          return Response.json({ task });
        }
        if (url.pathname === "/v1/tasks/upsert" && request.method === "POST") {
          let task = tasks.find((item) => (item.metadata as Record<string, unknown> | undefined)?.fingerprint === body.fingerprint);
          const created = !task;
          if (!task) {
            const id = TASK_IDS[nextTaskId++]!;
            task = { id, short_id: `REMOTE-${nextTaskId}`, title: body.title, description: body.description ?? null, status: body.status ?? "pending", priority: body.priority ?? "medium", project_id: body.project_id ?? null, task_list_id: body.task_list_id ?? null, plan_id: null, parent_id: null, assigned_to: body.assigned_to ?? null, tags: body.tags ?? [], metadata: { ...(body.metadata as object ?? {}), fingerprint: body.fingerprint }, version: 1, created_at: now, updated_at: now };
            tasks.push(task);
          } else {
            Object.assign(task, body, { updated_at: now, version: Number(task.version) + 1 });
          }
          return Response.json({ task, created }, { status: created ? 201 : 200 });
        }
        if (url.pathname === "/v1/tasks") {
          if (request.method === "GET") {
            let items = [...tasks];
            for (const key of ["status", "project_id", "task_list_id", "plan_id"] as const) {
              const value = url.searchParams.get(key);
              if (value) items = items.filter((item) => value.split(",").includes(String(item[key])));
            }
            const total = items.length;
            const limit = Number(url.searchParams.get("limit") ?? items.length);
            items = items.slice(0, Number.isFinite(limit) ? limit : items.length);
            return Response.json({ tasks: items, count: items.length, total });
          }
          if (request.method === "POST") {
            const id = TASK_IDS[nextTaskId++]!;
            const task = { id, short_id: `REMOTE-${nextTaskId}`, title: body.title, description: body.description ?? null, status: body.status ?? "pending", priority: body.priority ?? "medium", project_id: body.project_id ?? null, task_list_id: body.task_list_id ?? null, plan_id: body.plan_id ?? null, parent_id: body.parent_id ?? null, assigned_to: body.assigned_to ?? null, tags: body.tags ?? [], metadata: {}, version: 1, created_at: now, updated_at: now };
            tasks.push(task);
            return Response.json({ task }, { status: 201 });
          }
        }
        const commentMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/comments$/);
        if (commentMatch && request.method === "POST") {
          if (!find(tasks, commentMatch[1]!)) return Response.json({ error: "task not found" }, { status: 404 });
          return Response.json({
            comment: {
              id: "comment-1",
              task_id: commentMatch[1],
              content: body.content,
              agent_id: body.agent_id ?? null,
              session_id: body.session_id ?? null,
              type: body.type ?? "comment",
              progress_pct: body.progress_pct ?? null,
              created_at: now,
            },
          }, { status: 201 });
        }
        if (commentMatch && request.method === "GET") {
          return Response.json({ comments: [], count: 0, has_more: false, next_cursor: null });
        }
        const actionMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/(start|complete)$/);
        if (actionMatch && request.method === "POST") {
          const task = find(tasks, actionMatch[1]!);
          if (!task) return Response.json({ error: "task not found" }, { status: 404 });
          Object.assign(task, { status: actionMatch[2] === "start" ? "in_progress" : "completed", updated_at: now, version: Number(task.version) + 1 });
          return Response.json({ task });
        }
        const taskMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
        if (taskMatch) {
          const task = find(tasks, taskMatch[1]!);
          if (!task) return Response.json({ error: "task not found" }, { status: 404 });
          if (request.method === "GET") return Response.json({ task });
          if (request.method === "PATCH") {
            Object.assign(task, body, { updated_at: now, version: Number(task.version) + 1 });
            return Response.json({ task });
          }
          if (request.method === "DELETE") {
            remove(tasks, taskMatch[1]!);
            return Response.json({ deleted: true });
          }
        }

        return Response.json({ error: `fixture route not present: ${route}` }, { status: 404 });
      },
    });

    const root = mkdtempSync(join(tmpdir(), "todos-remote-lifecycle-"));
    tempRoots.push(root);
    const readOnlyParent = join(root, "read-only-db-parent");
    mkdirSync(readOnlyParent);
    chmodSync(readOnlyParent, 0o555);
    const localDbPath = join(readOnlyParent, "todos.db");
    const env = {
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_AUTO_PROJECT: "false",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
    };

    try {
      const invocations: string[][] = [
        ["--json", "projects", "--add", "/workspace/remote", "--name", "Remote"],
        ["--json", "projects"],
        ["--json", "projects", "--show", PROJECT_ID],
        ["--json", "projects", "--update", PROJECT_ID, "--description", "updated"],
        ["--project", PROJECT_ID, "--json", "lists", "--add", "Work", "--slug", "work"],
        ["--project", PROJECT_ID, "--json", "lists"],
        ["--project", PROJECT_ID, "--json", "lists", "--show", LIST_ID],
        ["--project", PROJECT_ID, "--json", "lists", "--update", LIST_ID, "--description", "updated"],
        ["--project", PROJECT_ID, "--json", "plans", "--add", "Delivery", "--slug", "delivery"],
        ["--project", PROJECT_ID, "--json", "plans"],
        ["--project", PROJECT_ID, "--json", "plans", "--show", PLAN_ID],
        ["--project", PROJECT_ID, "--json", "plans", "--complete", PLAN_ID],
        ["--project", PROJECT_ID, "--json", "status"],
        ["--json", "health"],
        ["--json", "doctor"],
        ["--json", "add", "Remote task", "--project", PROJECT_ID, "--list", LIST_ID, "--plan", PLAN_ID],
        ["--json", "task", "upsert", "--fingerprint", "incident-593127", "--title", "Upserted task", "--project", PROJECT_ID, "--list", LIST_ID],
        ["--project", PROJECT_ID, "--json", "list", "--list", LIST_ID],
        ["--json", "show", "REMOTE-1"],
        ["--json", "update", "REMOTE-1", "--title", "Moved task", "--list", LIST_ID, "--plan", PLAN_ID],
        ["--json", "comment", "REMOTE-1", "remote comment"],
        ["--json", "start", "REMOTE-1"],
        ["--json", "done", "REMOTE-1"],
        ["--project", PROJECT_ID, "--json", "next"],
        ["--json", "claim", "fixture-worker"],
        ["--json", "delete", "REMOTE-1"],
        ["--json", "remove", "REMOTE-2"],
        ["--project", PROJECT_ID, "--json", "plans", "--delete", PLAN_ID],
        ["--project", PROJECT_ID, "--json", "lists", "--delete", LIST_ID],
      ];

      for (const invocation of invocations) {
        const result = await runCli(executable, invocation, env);
        expect({ invocation, exitCode: result.exitCode, stderr: result.stderr }).toEqual({
          invocation,
          exitCode: 0,
          stderr: "",
        });
        expect(() => JSON.parse(result.stdout)).not.toThrow();
        expectNoLocalDatabase(root, localDbPath);
      }

      expect(requests.some((request) => request.startsWith("GET /v1/projects"))).toBe(true);
      expect(requests.some((request) => request.startsWith("GET /v1/task-lists?project_id="))).toBe(true);
      expect(requests.some((request) => request.startsWith("GET /v1/plans?project_id="))).toBe(true);
      expect(requests.some((request) => request.startsWith("POST /v1/tasks/upsert"))).toBe(true);
      expect(requests.some((request) => request.startsWith("POST /v1/tasks/next/claim"))).toBe(true);
      expectNoLocalDatabase(root, localDbPath);

      const invalidMode = await runCli(executable, ["--json", "projects"], {
        ...env,
        HASNA_TODOS_STORAGE_MODE: "remtoe",
      });
      expect(invalidMode.exitCode).toBe(1);
      expect(invalidMode.stderr).toContain("REMOTE_STORAGE_MODE_INVALID");
      expectNoLocalDatabase(root, localDbPath);

      const blankCanonical = await runCli(executable, ["--json", "projects"], {
        ...env,
        HASNA_TODOS_STORAGE_MODE: "",
        TODOS_STORAGE_MODE: "remote",
      });
      expect({ exitCode: blankCanonical.exitCode, stderr: blankCanonical.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(Array.isArray(JSON.parse(blankCanonical.stdout))).toBe(true);
      expectNoLocalDatabase(root, localDbPath);

      const conflictingModes = await runCli(executable, ["--json", "projects"], {
        ...env,
        HASNA_TODOS_STORAGE_MODE: "local",
        TODOS_STORAGE_MODE: "remote",
      });
      expect(conflictingModes.exitCode).toBe(1);
      expect(conflictingModes.stderr).toContain("REMOTE_STORAGE_MODE_CONFLICT");
      expectNoLocalDatabase(root, localDbPath);

      for (const unsupported of [
        ["--json", "inspect", "REMOTE-1"],
        ["--json", "projects", "--deregister", PROJECT_ID],
        ["--json", "projects", `--deregister=${PROJECT_ID}`],
        ["--json", "doctor", "--apply"],
        ["--project", PROJECT_ID, "--json", "plans", "--artifact", PLAN_ID],
        [`--project=${PROJECT_ID}`, "--json", "plans", `--artifact=${PLAN_ID}`],
        ["--project", PROJECT_ID, "--json", "claim", "fixture-worker"],
        [`--project=${PROJECT_ID}`, "--json", "claim", "fixture-worker"],
      ]) {
        const requestCount = requests.length;
        const result = await runCli(executable, unsupported, env);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("REMOTE_COMMAND_UNSUPPORTED");
        expect(requests).toHaveLength(requestCount);
        expectNoLocalDatabase(root, localDbPath);
      }
    } finally {
      chmodSync(readOnlyParent, 0o755);
      server.stop(true);
    }
  }, 30_000);
});
