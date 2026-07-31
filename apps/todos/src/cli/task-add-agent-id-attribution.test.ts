import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Regression coverage for the agent_id write path (todos task e54dcf6b).
 *
 * THE DEFECT. `todos add` stamps the CALLER's identity into `agent_id`:
 *
 *     const creator  = resolveCreatorIdentity(opts.createdBy || globalOpts.agent);
 *     const assignee = opts.assign || (opts.unassigned ? undefined : creator.agent_id);
 *     ...
 *     assigned_to: assignee,
 *     agent_id:    globalOpts.agent || creator.agent_id || undefined,   // <- the bug
 *     created_by:  creator.agent_id || undefined,
 *
 * `agent_id` is WRITTEN as the creator but READ as the assignee everywhere:
 *   - src/server/routes.ts          `t.assigned_to === agentId || t.agent_id === agentId`
 *   - src/cli/cloud-router.ts       `t.assigned_to ?? t.agent_id ?? "unassigned"`
 *   - src/mcp/tools/task-auto-tools.ts  agent_id described as "Filter by assignee"
 *
 * Creator attribution already has its own column (`created_by`), so stamping it into
 * `agent_id` as well is redundant AND corrupts the assignee. Two shapes result:
 *
 *   1. `--assign X` by creator C  -> assigned_to=X, agent_id=C. The two columns
 *      DISAGREE, so "who owns this" depends on which column the reader picked.
 *   2. `--unassigned` by creator C -> assigned_to=null, agent_id=C. The row is
 *      invisible to `--assigned` sweeps AND skipped by unassigned sweeps, because
 *      each sweep reads a different one of the two columns.
 *
 * Both were reproduced live against the hosted API on 2026-07-31 before this fix.
 * Shape 2 is the fleet-wide "121 tasks with agent_id set and assigned_to empty".
 *
 * These tests assert the VALUE the write path actually sends/stores. They are not
 * satisfied by a code path running: each one fails on the pre-fix bytes with
 * agent_id holding the creator instead of the assignee.
 */

const REPO_ROOT = join(import.meta.dir, "../..");
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const TEST_API_KEY = "hasna_todos_test_key";
const CREATOR = "cassius";
const ASSIGNEE = "brutus";
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function runCli(args: string[], root: string, extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "todos.db"),
      TODOS_AUTO_PROJECT: "false",
      // The documented per-session escape hatch, so the test never reads or writes
      // the real ~/.hasna/todos/identity.json.
      TODOS_AGENT_ID: CREATOR,
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
    task_list_id: null,
    title: "agent_id attribution regression",
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
    created_at: "2026-07-31T00:00:00.000Z",
    updated_at: "2026-07-31T00:00:00.000Z",
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
    created_by: null,
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

/** Capture the exact POST /v1/tasks body the CLI write path emits. */
function startCapturingServer(created: Array<Record<string, unknown>>) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/v1/tasks" && request.method === "POST") {
        const body = await request.json() as Record<string, unknown>;
        created.push(body);
        return Response.json({ task: taskFixture(body) }, { status: 201 });
      }
      if (url.pathname === "/v1/stats" && request.method === "GET") {
        return Response.json({ tasks_all: 0 });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
}

describe("todos add — agent_id must never carry the creator (cloud write path)", () => {
  test("--assign leaves agent_id agreeing with assigned_to, not the creator", async () => {
    const created: Array<Record<string, unknown>> = [];
    const server = startCapturingServer(created);
    const root = mkdtempSync(join(tmpdir(), "todos-agentid-assign-"));
    tempRoots.push(root);
    try {
      const add = await runCli(
        ["add", "agent_id attribution regression", "--assign", ASSIGNEE],
        root,
        {
          HASNA_TODOS_STORAGE_MODE: "self_hosted",
          HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
          HASNA_TODOS_API_KEY: TEST_API_KEY,
        },
      );
      expect(add.exitCode).toBe(0);
      expect(created).toHaveLength(1);
      const body = created[0]!;

      // The invariant: the two columns expressing "who owns this" must agree.
      expect(body["assigned_to"]).toBe(ASSIGNEE);
      expect(body["agent_id"]).toBe(ASSIGNEE);
      expect(body["agent_id"]).not.toBe(CREATOR);

      // ...and creator attribution is preserved in its own column, not lost.
      expect(body["created_by"]).toBe(CREATOR);
    } finally {
      server.stop(true);
    }
  });

  test("--unassigned leaves agent_id empty so an unassigned sweep can see the row", async () => {
    const created: Array<Record<string, unknown>> = [];
    const server = startCapturingServer(created);
    const root = mkdtempSync(join(tmpdir(), "todos-agentid-unassigned-"));
    tempRoots.push(root);
    try {
      const add = await runCli(
        ["add", "agent_id attribution regression", "--unassigned"],
        root,
        {
          HASNA_TODOS_STORAGE_MODE: "self_hosted",
          HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
          HASNA_TODOS_API_KEY: TEST_API_KEY,
        },
      );
      expect(add.exitCode).toBe(0);
      expect(created).toHaveLength(1);
      const body = created[0]!;

      // A deliberately ownerless task must be ownerless in BOTH columns, or it is
      // invisible to --assigned and skipped by an unassigned sweep at the same time.
      expect(body["assigned_to"] ?? null).toBeNull();
      expect(body["agent_id"] ?? null).toBeNull();

      // The filer is still recorded — unassigned is not unattributed.
      expect(body["created_by"]).toBe(CREATOR);
    } finally {
      server.stop(true);
    }
  });

  test("a registered creator with no --assign still self-assigns consistently", async () => {
    const created: Array<Record<string, unknown>> = [];
    const server = startCapturingServer(created);
    const root = mkdtempSync(join(tmpdir(), "todos-agentid-selfassign-"));
    tempRoots.push(root);
    try {
      const add = await runCli(
        ["add", "agent_id attribution regression"],
        root,
        {
          HASNA_TODOS_STORAGE_MODE: "self_hosted",
          HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
          HASNA_TODOS_API_KEY: TEST_API_KEY,
        },
      );
      expect(add.exitCode).toBe(0);
      const body = created[0]!;
      // Self-assignment is the existing default and is preserved; the point is that
      // the two columns agree, which here they incidentally already did.
      expect(body["assigned_to"]).toBe(CREATOR);
      expect(body["agent_id"]).toBe(CREATOR);
      expect(body["created_by"]).toBe(CREATOR);
    } finally {
      server.stop(true);
    }
  });
});

/**
 * The UPDATE half of the invariant.
 *
 * `todos update --assign X` wrote assigned_to and left agent_id on the previous owner,
 * exiting 0. Measured on the fleet 2026-07-31: 47 of 52 disagreeing rows were in exactly
 * that half-moved state — rows somebody had ALREADY tried to repair. The remediation was
 * the largest single producer of the corruption it was run to fix, so a fix that covers
 * only creation leaves the next sweep re-minting these rows.
 *
 * Creation and update are SEPARATE code paths; one fix does not cover both.
 */
describe("todos update — reassignment moves both ownership columns", () => {
  test("--assign updates agent_id alongside assigned_to in local SQLite", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-agentid-update-"));
    tempRoots.push(root);
    const dbPath = join(root, "todos.db");

    const add = await runCli(
      ["--json", "add", "reassignment regression", "--assign", CREATOR],
      root,
      { TODOS_DB_PATH: dbPath },
    );
    expect(add.exitCode).toBe(0);
    const taskId = (JSON.parse(add.stdout) as { id: string }).id;

    // Reassign to a different agent — the repair sweep's exact operation.
    const update = await runCli(
      ["update", taskId, "--assign", ASSIGNEE],
      root,
      { TODOS_DB_PATH: dbPath },
    );
    expect(update.exitCode).toBe(0);

    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .query("SELECT agent_id, assigned_to FROM tasks WHERE id = ?")
        .get(taskId) as { agent_id: string | null; assigned_to: string | null } | null;

      expect(row).not.toBeNull();
      expect(row!.assigned_to).toBe(ASSIGNEE);
      // The half-move: pre-fix this is still CREATOR while assigned_to moved.
      expect(row!.agent_id).toBe(ASSIGNEE);
    } finally {
      db.close();
    }
  });

  test("an update that does not touch --assign leaves ownership alone", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-agentid-update-noassign-"));
    tempRoots.push(root);
    const dbPath = join(root, "todos.db");

    const add = await runCli(
      ["--json", "add", "unrelated update regression", "--assign", ASSIGNEE],
      root,
      { TODOS_DB_PATH: dbPath },
    );
    expect(add.exitCode).toBe(0);
    const taskId = (JSON.parse(add.stdout) as { id: string }).id;

    const update = await runCli(
      ["update", taskId, "--priority", "high"],
      root,
      { TODOS_DB_PATH: dbPath },
    );
    expect(update.exitCode).toBe(0);

    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .query("SELECT agent_id, assigned_to, priority FROM tasks WHERE id = ?")
        .get(taskId) as { agent_id: string | null; assigned_to: string | null; priority: string } | null;

      // Guards the coupling against overreach: it must fire on reassignment only.
      expect(row!.priority).toBe("high");
      expect(row!.assigned_to).toBe(ASSIGNEE);
      expect(row!.agent_id).toBe(ASSIGNEE);
    } finally {
      db.close();
    }
  });
});

describe("todos add — attribution is never inferred from the assignee", () => {
  test("an unregistered filer records no creator rather than crediting the assignee", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-agentid-unattributed-"));
    tempRoots.push(root);
    const dbPath = join(root, "todos.db");

    // No TODOS_AGENT_ID and no persisted identity: the filer is genuinely unknown.
    const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", "add", "unattributed filer", "--assign", ASSIGNEE], {
      cwd: REPO_ROOT,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: root,
        TMPDIR: root,
        LANG: "C.UTF-8",
        TODOS_DB_PATH: dbPath,
        TODOS_AUTO_PROJECT: "false",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    await new Response(proc.stdout).text();
    await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(0);

    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .query("SELECT agent_id, assigned_to, created_by, assigned_by FROM tasks WHERE title = ?")
        .get("unattributed filer") as
        { agent_id: string | null; assigned_to: string | null; created_by: string | null; assigned_by: string | null } | null;

      expect(row!.assigned_to).toBe(ASSIGNEE);
      expect(row!.agent_id).toBe(ASSIGNEE);
      // A wrong name is worse than a missing one: the assignee must not be recorded
      // as having filed or handed over a task they never touched.
      expect(row!.created_by).toBeNull();
      expect(row!.assigned_by).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("todos add — agent_id must never carry the creator (local write path)", () => {
  test("--assign stores agent_id equal to assigned_to in local SQLite", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-agentid-local-"));
    tempRoots.push(root);
    const dbPath = join(root, "todos.db");

    const add = await runCli(
      ["add", "local agent_id attribution regression", "--assign", ASSIGNEE],
      root,
      { TODOS_DB_PATH: dbPath },
    );
    expect(add.exitCode).toBe(0);

    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .query("SELECT agent_id, assigned_to, created_by FROM tasks WHERE title = ?")
        .get("local agent_id attribution regression") as
        { agent_id: string | null; assigned_to: string | null; created_by: string | null } | null;

      expect(row).not.toBeNull();
      expect(row!.assigned_to).toBe(ASSIGNEE);
      expect(row!.agent_id).toBe(ASSIGNEE);
      expect(row!.agent_id).not.toBe(CREATOR);
      expect(row!.created_by).toBe(CREATOR);
    } finally {
      db.close();
    }
  });
});
