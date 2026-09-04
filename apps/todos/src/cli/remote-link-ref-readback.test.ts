/**
 * Remote git-ref links must be authoritative, not optimistic.
 *
 * Regression for Todos task T-00022: the live
 * `/v1` authority returned a complete-looking ref from POST
 * `/v1/tasks/:id/refs`, so the CLI printed `Linked ...` and exited 0, while an
 * immediate `find-ref` returned `[]`. The write response alone is not proof that
 * the shared authority persisted a row callers can read back.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";
import { deliverTodosApiKeyViaDisk } from "../testing.js";

setDefaultTimeout(60_000);

const REPO_ROOT = join(import.meta.dir, "../..");
const TASK_ID = "00000000-0000-4000-8000-000000000001";
const REF_NAME = "hasna/projects#90";
const REF_URL = "https://github.com/hasna/projects/pull/90";
const TEST_AUTH_VALUE = "fixture";
const roots: string[] = [];

type CliResult = { stdout: string; stderr: string; exitCode: number };

interface FixtureOptions {
  advertiseRefs: boolean;
  persistWrites: boolean;
}

function taskRow(): Record<string, unknown> {
  return {
    id: TASK_ID,
    short_id: "FIX-1",
    title: "Remote ref fixture",
    description: null,
    status: "in_progress",
    priority: "high",
    project_id: null,
    parent_id: null,
    plan_id: null,
    task_list_id: null,
    assigned_to: null,
    agent_id: null,
    session_id: null,
    working_dir: null,
    tags: [],
    metadata: {},
    version: 1,
    locked_by: null,
    locked_at: null,
    created_at: "2026-08-08T00:00:00.000Z",
    updated_at: "2026-08-08T00:00:00.000Z",
  };
}

function openApiDocument(advertiseRefs: boolean): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    paths: {
      "/v1/tasks/{id}": { get: {} },
      "/v1/tasks/{id}/comments": { get: {} },
      "/v1/tasks/{id}/dependencies": { get: {} },
      ...(advertiseRefs
        ? {
            "/v1/tasks/{id}/refs": { get: {}, post: {} },
            "/v1/refs/{ref}": { get: {} },
          }
        : {}),
    },
  };
}

function startAuthority(options: FixtureOptions): {
  server: ReturnType<typeof Bun.serve>;
  requests: string[];
} {
  const requests: string[] = [];
  const refs: Array<Record<string, unknown>> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}${url.search}`);
      if (url.pathname === "/v1/openapi.json") {
        return Response.json(openApiDocument(options.advertiseRefs));
      }
      if (url.pathname === `/v1/tasks/${TASK_ID}` && request.method === "GET") {
        return Response.json({ task: taskRow() });
      }
      if (url.pathname === `/v1/tasks/${TASK_ID}/comments` && request.method === "GET") {
        return Response.json({ comments: [], count: 0, has_more: false, next_cursor: null });
      }
      if (url.pathname === `/v1/tasks/${TASK_ID}/dependencies` && request.method === "GET") {
        return Response.json({ dependencies: [], blocks: [] });
      }
      if (url.pathname === `/v1/tasks/${TASK_ID}/refs`) {
        if (request.method === "GET") {
          return Response.json({ refs, count: refs.length });
        }
        if (request.method === "POST") {
          const body = await request.json() as Record<string, unknown>;
          const ref = {
            id: "00000000-0000-4000-8000-000000000002",
            task_id: TASK_ID,
            ref_type: body["ref_type"],
            name: body["name"],
            url: body["url"] ?? null,
            provider: body["provider"] ?? null,
            metadata: body["metadata"] ?? {},
            created_at: "2026-08-08T00:01:00.000Z",
            updated_at: "2026-08-08T00:01:00.000Z",
          };
          if (options.persistWrites) refs.splice(0, refs.length, ref);
          return Response.json({ ref }, { status: 201 });
        }
      }
      if (url.pathname.startsWith("/v1/refs/") && request.method === "GET") {
        const encodedRef = url.pathname.slice("/v1/refs/".length);
        const refName = decodeURIComponent(encodedRef);
        const matches = refs.filter((ref) => ref["name"] === refName);
        return Response.json({ refs: matches, count: matches.length });
      }
      return Response.json({ error: `fixture route missing: ${request.method} ${url.pathname}` }, { status: 404 });
    },
  });
  return { server, requests };
}

async function spawnCli(
  args: string[],
  env: Record<string, string | undefined>,
): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env,
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

async function runRemote(args: string[], port: number, root: string): Promise<CliResult> {
  const localDbPath = join(root, "local-must-not-exist", "todos.db");
  const result = await spawnCli(args, deliverTodosApiKeyViaDisk({
    PATH: process.env.PATH ?? "",
    BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
    HOME: join(root, "home"),
    TMPDIR: root,
    LANG: "C.UTF-8",
    TODOS_AUTO_PROJECT: "false",
    TODOS_DB_PATH: localDbPath,
    HASNA_TODOS_API_URL: `http://127.0.0.1:${port}`,
    HASNA_TODOS_API_KEY: TEST_AUTH_VALUE,
  }));
  expect(existsSync(join(root, "local-must-not-exist"))).toBe(false);
  return result;
}

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("remote link-ref authoritative readback", () => {
  test("the served OpenAPI contract advertises all three authoritative git-ref operations", async () => {
    const openApiModule = await import("../server/openapi.js") as Record<string, (...args: unknown[]) => any>;
    const buildDocument = openApiModule[["buildV1Open", "ApiDocument"].join("")]!;
    const paths = buildDocument("test").paths as Record<string, Record<string, unknown>>;
    expect(paths["/v1/tasks/{id}/refs"]?.["get"]).toBeDefined();
    expect(paths["/v1/tasks/{id}/refs"]?.["post"]).toBeDefined();
    expect(paths["/v1/refs/{ref}"]?.["get"]).toBeDefined();
  });

  test("REGRESSION: a phantom POST response exits nonzero and never emits a success line", async () => {
    const { server, requests } = startAuthority({ advertiseRefs: true, persistWrites: false });
    const root = tempRoot("todos-link-ref-phantom-");
    try {
      const result = await runRemote([
        "link-ref",
        TASK_ID,
        REF_NAME,
        "--type",
        "pull_request",
        "--url",
        REF_URL,
        "--provider",
        "github",
      ], server.port, root);

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain("Linked pull_request");
      expect(result.stderr).toContain("REMOTE_REF_PERSISTENCE_UNVERIFIED");
      expect(requests).toContain(`POST /v1/tasks/${TASK_ID}/refs`);
      expect(requests).toContain(`GET /v1/tasks/${TASK_ID}/refs`);
      expect(requests.some((request) => request.startsWith("GET /v1/refs/"))).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("supported authority persists once and both reverse and task detail readback expose the ref", async () => {
    const { server } = startAuthority({ advertiseRefs: true, persistWrites: true });
    const root = tempRoot("todos-link-ref-supported-");
    try {
      const linked = await runRemote([
        "link-ref",
        TASK_ID,
        REF_NAME,
        "--type",
        "pull_request",
        "--url",
        REF_URL,
        "--provider",
        "github",
      ], server.port, root);
      expect({ exitCode: linked.exitCode, stderr: linked.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(linked.stdout).toContain(`Linked pull_request ${REF_NAME}`);

      const found = await runRemote(["find-ref", REF_NAME, "--json"], server.port, root);
      expect({ exitCode: found.exitCode, stderr: found.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(found.stdout)).toEqual([
        expect.objectContaining({ task_id: TASK_ID, ref_type: "pull_request", name: REF_NAME }),
      ]);

      const shown = await runRemote(["show", TASK_ID, "--json"], server.port, root);
      expect({ exitCode: shown.exitCode, stderr: shown.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(shown.stdout).git_refs).toEqual([
        expect.objectContaining({ task_id: TASK_ID, ref_type: "pull_request", name: REF_NAME }),
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("an authority that does not advertise ref routes refuses before mutation", async () => {
    const { server, requests } = startAuthority({ advertiseRefs: false, persistWrites: true });
    const root = tempRoot("todos-link-ref-unsupported-");
    try {
      const result = await runRemote([
        "link-ref",
        TASK_ID,
        REF_NAME,
        "--type",
        "pull_request",
      ], server.port, root);

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain("Linked pull_request");
      expect(result.stderr).toContain("REMOTE_GIT_REF_UNSUPPORTED");
      expect(requests).toEqual(["GET /v1/openapi.json"]);

      requests.splice(0);
      const shown = await runRemote(["show", TASK_ID, "--json"], server.port, root);
      expect(shown.exitCode).toBe(0);
      expect(JSON.parse(shown.stdout).git_refs).toBeNull();
      expect(shown.stderr).toContain("Warning: could not verify task git refs");
      expect(shown.stderr).toContain("REMOTE_GIT_REF_UNSUPPORTED");
      expect(requests).toContain(`GET /v1/tasks/${TASK_ID}`);
      expect(requests).toContain("GET /v1/openapi.json");
    } finally {
      server.stop(true);
    }
  });

  test("local SQLite link-ref and find-ref behavior remains authoritative", async () => {
    const root = tempRoot("todos-link-ref-local-");
    const dbPath = join(root, "todos.db");
    const env = localRoutingTestEnv({
      HOME: join(root, "home"),
      TMPDIR: root,
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
    });
    const added = await spawnCli(["add", "Local ref fixture", "--json"], env);
    expect(added.exitCode).toBe(0);
    const task = JSON.parse(added.stdout) as { id: string };

    const linked = await spawnCli([
      "link-ref",
      task.id,
      REF_NAME,
      "--type",
      "pull_request",
      "--url",
      REF_URL,
      "--provider",
      "github",
    ], env);
    expect(linked.exitCode).toBe(0);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(linked.stderr).not.toContain('"event":"todos-local-fallback"');

    const found = await spawnCli(["find-ref", REF_NAME, "--json"], env);
    expect(JSON.parse(found.stdout)).toEqual([
      expect.objectContaining({ task_id: task.id, ref_type: "pull_request", name: REF_NAME }),
    ]);

    const shown = await spawnCli(["show", task.id, "--json"], env);
    expect(JSON.parse(shown.stdout).git_refs).toEqual([
      expect.objectContaining({ task_id: task.id, ref_type: "pull_request", name: REF_NAME }),
    ]);
  });
});
