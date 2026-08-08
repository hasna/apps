/**
 * Real composition regression for PLA-03362:
 *
 *   source CLI process -> @hasna/contracts HTTP client -> Bun HTTP server
 *   -> handleV1Request -> repository SQLite storage adapter -> independent show
 *
 * The faulted case removes the row after the real store accepted it while
 * returning the store's original create result. That models the measured
 * hosted failure without replacing the HTTP or storage layers with an echo
 * fixture: a POST response alone must never authorize a success row.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../db/schema.js";
import {
  findTasksByGitRef,
  getTaskGitRefs,
  linkTaskGitRef,
} from "../db/task-commits.js";
import {
  addDependency,
  getTaskDependencies,
  getTaskDependents,
  removeDependency,
} from "../db/task-graph.js";
import { handleV1Request, type V1RequestDependencies } from "../server/v1.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
import type { CreateTaskInput, Task } from "../types/index.js";

setDefaultTimeout(60_000);

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_AUTH_VALUE = "fixture";
const INVALID_PARENT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const tempRoots: string[] = [];
const authorities: Array<ReturnType<typeof createAuthority>> = [];

type CliResult = { stdout: string; stderr: string; exitCode: number };

interface AuthorityOptions {
  dropParentedWriteAfterCreate?: boolean;
}

function createAuthority(options: AuthorityOptions = {}) {
  const db = new Database(":memory:");
  runMigrations(db);
  const store = createLocalSqliteTodosStorageAdapter({ db });
  const originalCreate = store.tasks.create.bind(store.tasks);
  const originalDelete = store.tasks.delete.bind(store.tasks);
  let createCalls = 0;

  store.tasks.create = async (input, context) => {
    createCalls += 1;
    const task = await originalCreate(input, context);
    if (options.dropParentedWriteAfterCreate && input.parent_id) {
      await originalDelete(task.id, context);
    }
    return task;
  };
  const composedStore: TodosStorageAdapter = {
    ...store,
    dependencies: {
      add: (taskId, dependsOn) => {
        addDependency(taskId, dependsOn, db);
        return { task_id: taskId, depends_on: dependsOn };
      },
      remove: (taskId, dependsOn) => removeDependency(taskId, dependsOn, db),
      list: (taskId) => {
        const dependencies = getTaskDependencies(taskId, db);
        const blocks = getTaskDependents(taskId, db);
        return { dependencies, blocks, blocked_by: blocks };
      },
    },
    gitRefs: {
      add: (input) => linkTaskGitRef({
        task_id: input.task_id,
        ref_type: input.ref_type,
        name: input.name,
        ...(input.url ? { url: input.url } : {}),
        ...(input.provider ? { provider: input.provider } : {}),
        metadata: input.metadata,
      }, db),
      list: (taskId) => getTaskGitRefs(taskId, db),
      find: (ref) => findTasksByGitRef(ref, db),
    },
  };

  const dependencies: V1RequestDependencies = {
    ensureSchema: async () => {},
    getStorageAdapter: () => composedStore,
    getVerifier: () => ({
      authenticate: async () => ({
        ok: true as const,
        principal: {
          kid: "parent-create-composition",
          app: "todos",
          scopes: ["todos:*"],
          agent: "composition-agent",
          claims: {
            v: 1,
            kid: "parent-create-composition",
            app: "todos",
            scopes: ["todos:*"],
            iat: 0,
            exp: null,
          },
        },
      }),
    }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (
        request.method === "GET"
        && (url.pathname === "/openapi.json" || url.pathname === "/v1/openapi.json")
      ) {
        // `show` preflights the unrelated git-ref read capability. Advertise the
        // real route exercised below without replacing the task create/read
        // composition with an HTTP echo fixture.
        return Response.json({
          paths: {
            "/v1/tasks/{id}/refs": { get: {} },
          },
        });
      }
      const response = await handleV1Request(request, url, dependencies);
      return response ?? Response.json({ error: "not found" }, { status: 404 });
    },
  });

  return {
    db,
    server,
    store: composedStore,
    seedTask: (input: CreateTaskInput) => originalCreate(input),
    resetCreateCalls: () => {
      createCalls = 0;
    },
    createCalls: () => createCalls,
  };
}

async function runRemote(args: string[], port: number, root: string): Promise<CliResult> {
  const localDbPath = join(root, "local-must-not-exist", "todos.db");
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: join(root, "home"),
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_AUTO_PROJECT: "false",
      TODOS_AGENT_ID: "composition-agent",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_STORAGE_MODE: "http",
      HASNA_TODOS_API_URL: `http://127.0.0.1:${port}`,
      HASNA_TODOS_API_KEY: TEST_AUTH_VALUE,
    },
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

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const authority of authorities.splice(0)) {
    authority.server.stop(true);
    authority.db.close();
  }
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("remote parent create persistence composition", () => {
  test("REGRESSION: a valid parented create cannot print a ghost success row", async () => {
    const authority = createAuthority({ dropParentedWriteAfterCreate: true });
    authorities.push(authority);
    const parent = await authority.seedTask({ title: "Persisted parent" });
    authority.resetCreateCalls();

    const result = await runRemote([
      "--json",
      "add",
      "Dropped child",
      "--parent",
      parent.id,
      "--no-project",
    ], authority.server.port, tempRoot("todos-parent-create-ghost-"));

    expect(authority.createCalls(), "the CLI must issue exactly one create").toBe(1);
    expect(result.exitCode, "a missing authoritative readback must fail closed").not.toBe(0);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(output["error"]).toBeString();
    expect(output).not.toHaveProperty("id");
    expect(output).not.toHaveProperty("task");
    expect(result.stderr).toContain("TASK_CREATE_PERSISTENCE_UNVERIFIED");
    expect(await authority.store.tasks.count({ include_subtasks: true })).toBe(1);
  });

  test("a valid parented create persists once, returns the stored id, retains parent_id, and show reads it immediately", async () => {
    const authority = createAuthority();
    authorities.push(authority);
    const parent = await authority.seedTask({ title: "Persisted parent" });
    authority.resetCreateCalls();
    const root = tempRoot("todos-parent-create-valid-");

    const createdResult = await runRemote([
      "--json",
      "add",
      "Persisted child",
      "--parent",
      parent.id,
      "--no-project",
    ], authority.server.port, root);

    expect({ exitCode: createdResult.exitCode, stderr: createdResult.stderr }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    expect(authority.createCalls()).toBe(1);
    const created = JSON.parse(createdResult.stdout) as Task;
    const stored = await authority.store.tasks.get(created.id);
    expect(stored).not.toBeNull();
    expect(created.id).toBe(stored!.id);
    expect(created.parent_id).toBe(parent.id);
    expect(stored!.parent_id).toBe(parent.id);

    const shownResult = await runRemote(
      ["--json", "show", created.id],
      authority.server.port,
      root,
    );
    expect({ exitCode: shownResult.exitCode, stderr: shownResult.stderr }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    expect(JSON.parse(shownResult.stdout)).toMatchObject({
      id: created.id,
      parent_id: parent.id,
    });
    expect(authority.createCalls(), "show must not replay the create").toBe(1);
  });

  test("a nonexistent parent exits nonzero and emits no human success row", async () => {
    const authority = createAuthority();
    authorities.push(authority);

    const result = await runRemote([
      "add",
      "Invalid child",
      "--parent",
      INVALID_PARENT_ID,
      "--no-project",
    ], authority.server.port, tempRoot("todos-parent-create-invalid-"));

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("Task created:");
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr.trim().length).toBeGreaterThan(0);
    expect(authority.createCalls(), "an invalid parent must fail before storage create").toBe(0);
    expect(await authority.store.tasks.count({ include_subtasks: true })).toBe(0);
  });

  test("parentless create remains a single persisted create and is immediately readable", async () => {
    const authority = createAuthority();
    authorities.push(authority);
    const root = tempRoot("todos-parent-create-parentless-");

    const createdResult = await runRemote([
      "--json",
      "add",
      "Parentless control",
      "--no-project",
    ], authority.server.port, root);

    expect({ exitCode: createdResult.exitCode, stderr: createdResult.stderr }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    expect(authority.createCalls()).toBe(1);
    const created = JSON.parse(createdResult.stdout) as Task;
    expect(created.parent_id).toBeNull();
    expect((await authority.store.tasks.get(created.id))?.parent_id).toBeNull();

    const shownResult = await runRemote(
      ["--json", "show", created.id],
      authority.server.port,
      root,
    );
    expect({ exitCode: shownResult.exitCode, stderr: shownResult.stderr }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    expect(JSON.parse(shownResult.stdout)).toMatchObject({
      id: created.id,
      parent_id: null,
    });
    expect(authority.createCalls()).toBe(1);
  });
});
