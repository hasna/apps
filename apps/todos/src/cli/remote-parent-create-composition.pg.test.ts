/**
 * REAL Postgres remote-route composition regression for parented creates —
 * the exact shape of the measured hosted ghost-task defect (todos task
 * 639b1bd2): `todos add --parent <id>` against a /v1 authority returned
 * rc=0 and a full row that never persisted (immediate `todos show` 404).
 *
 * The SQLite twin of this file (remote-parent-create-composition.test.ts)
 * covers the same composition over the local adapter; the hosted authority is
 * Postgres, and this file pins the CLI -> /v1 -> Postgres route so the
 * measured failure shape cannot return unguarded:
 *
 *   source CLI process -> @hasna/contracts HTTP client -> Bun HTTP server
 *   -> handleV1Request -> Postgres storage adapter -> independent CLI show
 *
 * Guarded by TODOS_TEST_PG_URL so the default no-Postgres lane skips it:
 *   TODOS_TEST_PG_URL=postgres://localhost:5432/todos_reftest \
 *     bun test src/cli/remote-parent-create-composition.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "../storage/cloud-client.js";
import { createPostgresTodosStorageAdapter } from "../storage/postgres-adapter.js";
import { postgresTodosSyncSchemaSql } from "../storage/postgres-sync.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import { handleV1Request } from "../server/v1.js";
import type { CreateTaskInput, Task } from "../types/index.js";
import { deliverTodosApiKeyViaDisk } from "../testing.js";

setDefaultTimeout(90_000);

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_AUTH_VALUE = "fixture";
const INVALID_PARENT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

type CliResult = { stdout: string; stderr: string; exitCode: number };

describe.skipIf(!PG_URL)("remote parented create persistence composition (postgres)", () => {
  let client: TodosCloudQueryClient;
  let store: TodosStorageAdapter;
  let server: ReturnType<typeof Bun.serve>;
  let service: string;
  let projectId: string;
  let createCalls = 0;
  let seedCreate: TodosStorageAdapter["tasks"]["create"] = async () => {
    throw new Error("create not bound yet");
  };
  let dropParentedWrite = false;
  const tempRoots: string[] = [];

  const seedTask = (input: CreateTaskInput) => seedCreate(input);

  beforeAll(async () => {
    service = `todos-parent-create-pg-${process.pid}-${Date.now()}`;
    client = createTodosCloudQueryClient(PG_URL!);
    for (const sql of postgresTodosSyncSchemaSql()) await client.query(sql);
    store = createPostgresTodosStorageAdapter({ client, service });
    projectId = (await store.projects.create({
      name: "PG composition project",
      path: "/tmp/pg-composition-project",
    })).id;
    // Fault injection, same mechanism as the SQLite composition twin: drop the
    // row AFTER the real store accepted the create, so the POST acknowledgement
    // alone can never authorize a success row.
    seedCreate = store.tasks.create.bind(store.tasks);
    const boundCreate = store.tasks.create.bind(store.tasks);
    const boundDelete = store.tasks.delete.bind(store.tasks);
    store.tasks.create = async (input, context) => {
      createCalls += 1;
      const task = await boundCreate(input, context);
      if (dropParentedWrite && input.parent_id) {
        await boundDelete(task.id, context);
      }
      return task;
    };

    const dependencies = {
      ensureSchema: async () => {},
      getStorageAdapter: () => store,
      getVerifier: () => ({
        authenticate: async () => ({
          ok: true as const,
          principal: {
            kid: "parent-create-composition-pg",
            app: "todos",
            scopes: ["todos:*"],
            agent: "composition-pg-agent",
            claims: {
              v: 1,
              kid: "parent-create-composition-pg",
              app: "todos",
              scopes: ["todos:*"],
              iat: 0,
              exp: null,
            },
          },
        }),
      }) as never,
    };

    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (
          request.method === "GET"
          && (url.pathname === "/openapi.json" || url.pathname === "/v1/openapi.json")
        ) {
          return Response.json({
            paths: { "/v1/tasks/{id}/refs": { get: {} } },
          });
        }
        const response = await handleV1Request(request, url, dependencies);
        return response ?? Response.json({ error: "not found" }, { status: 404 });
      },
    });
  });

  afterAll(async () => {
    if (!PG_URL) return;
    server?.stop(true);
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [service]);
    await client.close();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function tempRoot(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), prefix));
    tempRoots.push(root);
    return root;
  }

  async function runRemote(args: string[], root: string): Promise<CliResult> {
    const localDbPath = join(root, "local-must-not-exist", "todos.db");
    const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
      cwd: REPO_ROOT,
      env: deliverTodosApiKeyViaDisk({
        PATH: process.env.PATH ?? "",
        BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
        HOME: join(root, "home"),
        TMPDIR: root,
        LANG: "C.UTF-8",
        TODOS_AUTO_PROJECT: "false",
        TODOS_AGENT_ID: "composition-pg-agent",
        TODOS_DB_PATH: localDbPath,
        HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_TODOS_API_KEY: TEST_AUTH_VALUE,
      }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(existsSync(join(root, "local-must-not-exist"))).toBe(false);
    return { stdout, stderr, exitCode };
  }

  test("REGRESSION: valid --parent create persists exactly one task with parent_id and immediate show succeeds", async () => {
    const parent = await seedTask({ title: "PG persisted parent", project_id: projectId });
    const before = await store.tasks.count({ include_subtasks: true });
    const root = tempRoot("todos-pg-parent-create-valid-");
    createCalls = 0;

    const createdResult = await runRemote([
      "--json",
      "add",
      "PG persisted child",
      "--parent",
      parent.id,
      "--project",
      projectId,
    ], root);

    expect({ exitCode: createdResult.exitCode, stderr: createdResult.stderr }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    expect(createCalls, "the CLI must issue exactly one create").toBe(1);
    const created = JSON.parse(createdResult.stdout) as Task;
    expect(created.parent_id).toBe(parent.id);
    const stored = await store.tasks.get(created.id);
    expect(stored).not.toBeNull();
    expect(stored!.id).toBe(created.id);
    expect(stored!.parent_id).toBe(parent.id);
    expect(await store.tasks.count({ include_subtasks: true })).toBe(before + 1);

    const shownResult = await runRemote(["--json", "show", created.id], root);
    expect({ exitCode: shownResult.exitCode, stderr: shownResult.stderr }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    expect(JSON.parse(shownResult.stdout)).toMatchObject({
      id: created.id,
      parent_id: parent.id,
    });
    expect(createCalls, "show must not replay the create").toBe(1);
  });

  test("REGRESSION: a parented create whose row is dropped after the store accepted it fails closed with no success row", async () => {
    const parent = await seedTask({ title: "PG dropped-write parent" });
    const before = await store.tasks.count({ include_subtasks: true });
    const root = tempRoot("todos-pg-parent-create-ghost-");
    dropParentedWrite = true;
    createCalls = 0;

    const result = await runRemote([
      "--json",
      "add",
      "PG dropped child",
      "--parent",
      parent.id,
      "--no-project",
    ], root);

    dropParentedWrite = false;
    expect(createCalls, "the CLI must issue exactly one create").toBe(1);
    expect(result.exitCode, "a missing authoritative readback must fail closed").not.toBe(0);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(output).not.toHaveProperty("id");
    expect(output).not.toHaveProperty("task");
    expect(result.stdout).not.toContain("Task created:");
    expect(await store.tasks.count({ include_subtasks: true })).toBe(before);
  });

  test("REGRESSION: a nonexistent parent exits nonzero and emits no synthetic success row", async () => {
    const before = await store.tasks.count({ include_subtasks: true });
    const root = tempRoot("todos-pg-parent-create-invalid-");
    createCalls = 0;

    const result = await runRemote([
      "--json",
      "add",
      "PG invalid child",
      "--parent",
      INVALID_PARENT_ID,
      "--no-project",
    ], root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("Task created:");
    expect(result.stderr.trim().length).toBeGreaterThan(0);
    expect(createCalls, "an invalid parent must fail before storage create").toBe(0);
    expect(await store.tasks.count({ include_subtasks: true })).toBe(before);
  });

  test("parentless create remains a single persisted create and is immediately readable", async () => {
    const before = await store.tasks.count({ include_subtasks: true });
    const root = tempRoot("todos-pg-parent-create-parentless-");
    createCalls = 0;

    const createdResult = await runRemote([
      "--json",
      "add",
      "PG parentless control",
      "--no-project",
    ], root);

    expect({ exitCode: createdResult.exitCode, stderr: createdResult.stderr }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    expect(createCalls).toBe(1);
    const created = JSON.parse(createdResult.stdout) as Task;
    expect(created.parent_id).toBeNull();
    expect((await store.tasks.get(created.id))?.parent_id).toBeNull();
    expect(await store.tasks.count({ include_subtasks: true })).toBe(before + 1);

    const shownResult = await runRemote(["--json", "show", created.id], root);
    expect({ exitCode: shownResult.exitCode, stderr: shownResult.stderr }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    expect(JSON.parse(shownResult.stdout)).toMatchObject({
      id: created.id,
      parent_id: null,
    });
    expect(createCalls).toBe(1);
  });
});
