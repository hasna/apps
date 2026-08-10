import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";
import { cliSpawnBudgetMs } from "../test/spawn-budget.js";

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_API_KEY = ["fixture", "api", "key"].join("-");
const CREATED_TASK_ID = "99999999-2222-4333-8444-555555555555";
const tempRoots: string[] = [];
const servers: Bun.Server<unknown>[] = [];

interface ReturnedRouting {
  createdBy: string | null;
  assignedTo: string | null;
  agentId: string | null;
}

function startAuthority(returned: ReturnedRouting) {
  const creates: Array<Record<string, unknown>> = [];
  let persistedTask: Record<string, unknown> | null = null;
  let readCalls = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/v1/tasks" && request.method === "POST") {
        const body = (await request.json()) as Record<string, unknown>;
        creates.push(body);
        persistedTask = {
          id: CREATED_TASK_ID,
          short_id: "FIX-00001",
          project_id: null,
          parent_id: null,
          plan_id: null,
          task_list_id: null,
          title: body["title"],
          description: null,
          status: "pending",
          priority: "medium",
          agent_id: returned.agentId,
          assigned_to: returned.assignedTo,
          session_id: null,
          working_dir: body["working_dir"] ?? null,
          tags: [],
          metadata: {},
          version: 1,
          locked_by: null,
          locked_at: null,
          created_by: returned.createdBy,
          created_at: "2026-08-10T00:00:00.000Z",
          updated_at: "2026-08-10T00:00:00.000Z",
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
          assigned_by: returned.agentId,
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
        };
        return Response.json({ task: persistedTask }, { status: 201 });
      }
      if (
        url.pathname === `/v1/tasks/${CREATED_TASK_ID}`
        && request.method === "GET"
        && persistedTask
      ) {
        readCalls += 1;
        return Response.json({ task: persistedTask });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  servers.push(server);
  return {
    creates,
    readCalls: () => readCalls,
    server,
  };
}

function makeRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `todos-authoritative-warning-${label}-`));
  tempRoots.push(root);
  return root;
}

async function runCli(args: string[], root: string, baseUrl: string) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: localRoutingTestEnv({
      HOME: join(root, "home"),
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "local-must-not-be-used.db"),
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_STORAGE_MODE: "http",
      TODOS_STORAGE_MODE: "http",
      HASNA_TODOS_API_URL: baseUrl,
      HASNA_TODOS_API_KEY: TEST_API_KEY,
      TODOS_AGENT_ID: "",
      HASNA_TODOS_AGENT_ID: "",
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

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("todos add warnings use the authoritative returned task", () => {
  test("does not claim created_by is null when the authority returns fleet attribution", async () => {
    const authority = startAuthority({
      createdBy: "fleet",
      assignedTo: null,
      agentId: "fleet",
    });
    const result = await runCli(
      ["--json", "add", "--unassigned", "--no-project", "hosted normalized attribution"],
      makeRoot("normalized"),
      `http://127.0.0.1:${authority.server.port}`,
    );

    expect(result).toMatchObject({ exitCode: 0 });
    expect(authority.creates).toHaveLength(1);
    expect(authority.creates[0]!["created_by"]).toBeUndefined();
    expect(authority.readCalls(), "the CLI must use the authoritative persisted readback").toBe(1);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: CREATED_TASK_ID,
      created_by: "fleet",
      assigned_to: null,
      agent_id: "fleet",
    });
    expect(result.stderr).not.toContain("unattributable");
    expect(result.stderr).not.toContain("created_by will be recorded as null");
    expect(result.stderr).toBe("");
  }, cliSpawnBudgetMs(1));

  test("still warns when the authoritative returned task has null created_by", async () => {
    const authority = startAuthority({
      createdBy: null,
      assignedTo: null,
      agentId: null,
    });
    const result = await runCli(
      ["--json", "add", "--unassigned", "--no-project", "hosted unattributable task"],
      makeRoot("null"),
      `http://127.0.0.1:${authority.server.port}`,
    );

    expect(result).toMatchObject({ exitCode: 0 });
    expect(authority.creates).toHaveLength(1);
    expect(authority.readCalls()).toBe(1);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: CREATED_TASK_ID,
      created_by: null,
      assigned_to: null,
    });
    expect(result.stderr).toContain(
      "Warning: task is unattributable — created_by will be recorded as null.",
    );
    expect(result.stderr).not.toContain("ownerless");
  }, cliSpawnBudgetMs(1));

  test("still warns about an ownerless returned task without calling it unattributable", async () => {
    const authority = startAuthority({
      createdBy: "fleet",
      assignedTo: null,
      agentId: "fleet",
    });
    const result = await runCli(
      ["--json", "add", "--no-project", "hosted ownerless attributed task"],
      makeRoot("ownerless"),
      `http://127.0.0.1:${authority.server.port}`,
    );

    expect(result).toMatchObject({ exitCode: 0 });
    expect(authority.creates).toHaveLength(1);
    expect(authority.readCalls()).toBe(1);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: CREATED_TASK_ID,
      created_by: "fleet",
      assigned_to: null,
    });
    expect(result.stderr).toContain("Warning: task is ownerless");
    expect(result.stderr).not.toContain("unattributable");
    expect(result.stderr).not.toContain("created_by will be recorded as null");
  }, cliSpawnBudgetMs(1));
});
