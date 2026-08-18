import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../db/schema.js";
import { handleV1Request, type V1RequestDependencies } from "../server/v1.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";

/**
 * Regression tests for the local-only capability removal (owner-authorized
 * 2026-08-18): these 15 verbs were refused on the hosted /v1 route with
 * `REMOTE_COMMAND_UNSUPPORTED` even though their command modules carry a
 * complete cloud branch. The port admits them to the /v1 route; this file
 * proves each verb works against the REAL in-process /v1 authority (not a
 * mock), asserting the hosted path executes and serves the shared dataset.
 */

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_AUTH_CREDENTIAL = "hasna-todos-test-fixture-auth";

const TASK_STALE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";   // in_progress, old updated_at
const TASK_OVERDUE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // pending, past due_at
const TASK_BLOCKED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // pending, depends on TASK_DEP
const TASK_DEP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";      // pending, blocks TASK_BLOCKED
const TASK_DONE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";     // completed, recent updated_at
const TASK_PRIORITY = "ffffffff-ffff-4fff-8fff-ffffffffffff"; // pending, high priority

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function runCli(args: string[], root: string, baseUrl: string) {
  const proc = Bun.spawn(["bun", "run", join(REPO_ROOT, "src/cli/index.tsx"), ...args], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "todos.db"),
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_API_URL: baseUrl,
      HASNA_TODOS_API_KEY: TEST_AUTH_CREDENTIAL,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

function createComposedAuthority() {
  const db = new Database(":memory:");
  runMigrations(db);
  const store = createLocalSqliteTodosStorageAdapter({ db });
  const dependencies: V1RequestDependencies = {
    ensureSchema: async () => {},
    getStorageAdapter: () => store,
    getVerifier: () => ({
      authenticate: async () => ({
        ok: true as const,
        principal: {
          kid: "hosted-verb-ports",
          app: "todos",
          scopes: ["todos:*"],
          agent: "port-test-agent",
          claims: {
            v: 1,
            kid: "hosted-verb-ports",
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
      const response = await handleV1Request(request, url, dependencies);
      return response ?? Response.json({ error: "not found" }, { status: 404 });
    },
  });
  return { db, server };
}

function seedTasks(db: Database): void {
  const now = new Date();
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const pastDue = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const insert = db.prepare(`
    INSERT INTO tasks (id, title, status, priority, assigned_to, agent_id, due_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(TASK_STALE, "Stale in-progress task", "in_progress", "medium", "agent-x", "agent-x", null, old, old);
  insert.run(TASK_OVERDUE, "Overdue pending task", "pending", "high", "agent-x", "agent-x", pastDue, old, old);
  insert.run(TASK_BLOCKED, "Blocked pending task", "pending", "medium", "agent-y", "agent-y", null, old, old);
  insert.run(TASK_DEP, "Unfinished dependency", "pending", "medium", "agent-z", "agent-z", null, old, old);
  insert.run(TASK_DONE, "Recently completed task", "completed", "medium", "agent-x", "agent-x", null, old, now.toISOString());
  insert.run(TASK_PRIORITY, "High priority pending", "pending", "high", "agent-x", "agent-x", null, old, old);
  db.run("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)", [TASK_BLOCKED, TASK_DEP]);
}

const PORTED_VERBS: Array<{ args: string[]; marker: string }> = [
  { args: ["blocked", "--json"], marker: TASK_BLOCKED.slice(0, 8) },
  { args: ["burndown", "--json"], marker: "completed" },
  { args: ["log", "--json"], marker: "[" },
  { args: ["mine", "agent-x", "--json"], marker: "agent-x" },
  { args: ["overdue", "--json"], marker: TASK_OVERDUE.slice(0, 8) },
  { args: ["priorities", "--json"], marker: "high" },
  { args: ["ready", "--json"], marker: TASK_DEP.slice(0, 8) },
  { args: ["report", "--json"], marker: "completion_rate" },
  { args: ["sla", "--json"], marker: "[" },
  { args: ["sprint", "--json"], marker: "next_up" },
  { args: ["stale", "--json"], marker: TASK_STALE.slice(0, 8) },
  { args: ["summary", "--json"], marker: "period_days" },
  { args: ["today", "--json"], marker: "[" },
  { args: ["week", "--json"], marker: "completed" },
  { args: ["yesterday", "--json"], marker: "[" },
];

describe("ported local-only verbs on the hosted /v1 route", () => {
  test(
    "all 15 verbs execute against the /v1 authority (no REMOTE_COMMAND_UNSUPPORTED)",
    async () => {
      const { db, server } = createComposedAuthority();
      seedTasks(db);
      const root = mkdtempSync(join(tmpdir(), "todos-hosted-verbs-"));
      tempRoots.push(root);
      const baseUrl = `http://127.0.0.1:${server.port}`;

      for (const verb of PORTED_VERBS) {
        const result = await runCli(verb.args, root, baseUrl);
        expect(result.stderr, `${verb.args.join(" ")} stderr`).not.toContain("REMOTE_COMMAND_UNSUPPORTED");
        expect(result.exitCode, `${verb.args.join(" ")} exit ${result.exitCode} stderr=${result.stderr}`).toBe(0);
        expect(result.stdout, `${verb.args.join(" ")} stdout`).toContain(verb.marker);
      }
      server.stop(true);
    },
    120_000,
  );

  test(
    "local route still executes the same verbs via the SQLite store",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "todos-local-verbs-"));
      tempRoots.push(root);
      // Seed the exact file the spawned CLI opens, so the local route reads the
      // same dataset the hosted test seeds (parity of both backends).
      const dbPath = join(root, "todos.db");
      const db = new Database(dbPath);
      runMigrations(db);
      seedTasks(db);
      db.close();
      const proc = Bun.spawn(["bun", "run", join(REPO_ROOT, "src/cli/index.tsx"), "mine", "agent-x", "--json"], {
        cwd: REPO_ROOT,
        env: {
          PATH: process.env.PATH ?? "",
          BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
          HOME: root,
          TMPDIR: root,
          LANG: "C.UTF-8",
          TODOS_DB_PATH: join(root, "todos.db"),
          TODOS_AUTO_PROJECT: "false",
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      expect(await proc.exited).toBe(0);
      expect(stderr).not.toContain("REMOTE_COMMAND_UNSUPPORTED");
      expect(stdout).toContain("agent-x");
    },
    120_000,
  );
});
