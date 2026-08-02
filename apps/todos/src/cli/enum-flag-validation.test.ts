/**
 * Regression suite for the silent-empty enum filter defect (todos task b7dbc881).
 *
 * `todos list --status open` used to exit 0 printing "No tasks found." on a project
 * with 27 real tasks, because `open` is not in `TASK_STATUSES` and the raw value was
 * forwarded into the storage filter, where it matched nothing. A human relayed that
 * empty set to the owner as "no open work".
 *
 * The invariant asserted here: an out-of-vocabulary value for a closed-vocabulary
 * flag exits NON-ZERO and names the allowed values on stderr — never an empty
 * result set with exit 0. Asserted in BOTH storage modes, because the incident
 * happened against the shared self-hosted authority, not local SQLite.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";
import { DISPATCH_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from "../types/index.js";

// Every case here spawns a cold `bun run src/cli/index.tsx`, and the local-mode
// cases spawn several in sequence. Match the budget cli.test.ts already sets.
setDefaultTimeout(30_000);

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_API_KEY = "hasna_todos_test_key";
const tempRoots: string[] = [];

type CliResult = { stdout: string; stderr: string; exitCode: number };

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function spawnCli(args: string[], env: Record<string, string | undefined>): Promise<CliResult> {
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

/** Run the CLI against an isolated local SQLite store — never the developer's. */
async function runLocal(args: string[], root: string): Promise<CliResult> {
  return spawnCli(args, localRoutingTestEnv({
    HOME: join(root, "home"),
    TMPDIR: root,
    LANG: "C.UTF-8",
    TODOS_DB_PATH: join(root, "todos.db"),
    TODOS_AUTO_PROJECT: "false",
    HASNA_EVENTS_DIR: join(root, "events"),
  }));
}

/**
 * Run the CLI in self_hosted (remote) mode against a stub `/v1` authority, and
 * report every request it received. A request count of zero proves the CLI
 * rejected the value locally instead of asking the authority to filter on it.
 */
async function runRemote(
  args: string[],
  tasks: Array<Record<string, unknown>>,
): Promise<CliResult & { requests: Array<{ path: string; query: string }> }> {
  const requests: Array<{ path: string; query: string }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push({ path: url.pathname, query: url.searchParams.toString() });
      if (url.pathname === "/v1/tasks") {
        return Response.json({ tasks, count: tasks.length, total: tasks.length });
      }
      if (url.pathname === "/v1/projects") return Response.json({ projects: [] });
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  const root = tempRoot("todos-enum-remote-");
  try {
    const result = await spawnCli(args, {
      PATH: process.env.PATH ?? "",
      HOME: join(root, "home"),
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "todos.db"),
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_STORAGE_MODE: "self_hosted",
      HASNA_TODOS_API_URL: server.url.origin,
      HASNA_TODOS_API_KEY: TEST_API_KEY,
    });
    return { ...result, requests };
  } finally {
    await server.stop(true);
  }
}

function remoteTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    short_id: "22222222",
    title: "Remote seeded task",
    status: "pending",
    priority: "critical",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

async function seedLocal(root: string): Promise<void> {
  await runLocal(["add", "Enum fixture pending medium", "-p", "medium"], root);
  await runLocal(["add", "Enum fixture pending critical", "-p", "critical"], root);
}

describe("todos list rejects out-of-vocabulary --status (local store)", () => {
  test.each([
    ["open", "the value from the incident"],
    ["all", "reads as everything, used to return nothing"],
    ["totally_bogus_value", "arbitrary junk"],
  ])("exits non-zero for --status %s (%s)", async (value) => {
    const root = tempRoot("todos-enum-status-");
    await seedLocal(root);
    const result = await runLocal(["list", "--status", value], root);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("No tasks found.");
  });

  test("names every allowed status on stderr, sourced from TASK_STATUSES", async () => {
    const root = tempRoot("todos-enum-status-msg-");
    await seedLocal(root);
    const result = await runLocal(["list", "--status", "open"], root);
    expect(result.exitCode).not.toBe(0);
    for (const status of TASK_STATUSES) expect(result.stderr).toContain(status);
  });

  test("points --status all at the flag that actually widens the filter", async () => {
    const root = tempRoot("todos-enum-status-all-");
    await seedLocal(root);
    const result = await runLocal(["list", "--status", "all"], root);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--all");
  });

  test("still lists the right rows for a valid status", async () => {
    const root = tempRoot("todos-enum-status-valid-");
    await seedLocal(root);
    const result = await runLocal(["list", "--status", "pending", "--json"], root);
    expect(result.exitCode).toBe(0);
    const tasks = JSON.parse(result.stdout) as Array<{ status: string }>;
    expect(tasks.length).toBe(2);
    expect(tasks.every((task) => task.status === "pending")).toBe(true);
  });

  test("accepts a capitalised status instead of silently matching nothing", async () => {
    const root = tempRoot("todos-enum-status-case-");
    await seedLocal(root);
    const result = await runLocal(["list", "--status", "Pending", "--json"], root);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as unknown[]).length).toBe(2);
  });

  test("accepts a documented status alias", async () => {
    const root = tempRoot("todos-enum-status-alias-");
    await seedLocal(root);
    const result = await runLocal(["list", "--status", "done", "--json"], root);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as unknown[]).length).toBe(0);
  });

  test("rejects a comma list containing one bad element rather than dropping it", async () => {
    const root = tempRoot("todos-enum-status-list-");
    await seedLocal(root);
    const result = await runLocal(["list", "--status", "pending,bogus"], root);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("bogus");
  });

  test("accepts a comma list whose every element is valid", async () => {
    const root = tempRoot("todos-enum-status-list-ok-");
    await seedLocal(root);
    const result = await runLocal(["list", "--status", "pending,in_progress", "--json"], root);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as unknown[]).length).toBe(2);
  });
});

describe("todos list rejects out-of-vocabulary --priority (local store)", () => {
  test("exits non-zero and names every allowed priority", async () => {
    const root = tempRoot("todos-enum-prio-");
    await seedLocal(root);
    const result = await runLocal(["list", "--priority", "totally_bogus_value"], root);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("No tasks found.");
    for (const priority of TASK_PRIORITIES) expect(result.stderr).toContain(priority);
  });

  test("still lists the right rows for a valid priority", async () => {
    const root = tempRoot("todos-enum-prio-valid-");
    await seedLocal(root);
    const result = await runLocal(["list", "--priority", "critical", "--json"], root);
    expect(result.exitCode).toBe(0);
    const tasks = JSON.parse(result.stdout) as Array<{ priority: string }>;
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.priority).toBe("critical");
  });

  test("matches a comma-separated priority list instead of the literal string", async () => {
    const root = tempRoot("todos-enum-prio-list-");
    await seedLocal(root);
    const result = await runLocal(["list", "--priority", "medium,critical", "--json"], root);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as unknown[]).length).toBe(2);
  });

  test("rejects a comma list containing one bad element", async () => {
    const root = tempRoot("todos-enum-prio-list-bad-");
    await seedLocal(root);
    const result = await runLocal(["list", "--priority", "critical,bogus"], root);
    expect(result.exitCode).not.toBe(0);
  });
});

describe("todos list rejects out-of-vocabulary enums against a self-hosted authority", () => {
  test("rejects --status open without asking the authority to filter on it", async () => {
    const result = await runRemote(["list", "--status", "open"], [remoteTask()]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("No tasks found.");
    for (const status of TASK_STATUSES) expect(result.stderr).toContain(status);
    expect(result.requests.filter((request) => request.path === "/v1/tasks")).toEqual([]);
  });

  test("rejects --priority junk without asking the authority to filter on it", async () => {
    const result = await runRemote(["list", "--priority", "totally_bogus_value"], [remoteTask()]);
    expect(result.exitCode).not.toBe(0);
    for (const priority of TASK_PRIORITIES) expect(result.stderr).toContain(priority);
    expect(result.requests.filter((request) => request.path === "/v1/tasks")).toEqual([]);
  });

  test("rejects a remote --status comma list with one bad element", async () => {
    const result = await runRemote(["list", "--status", "pending,bogus"], [remoteTask()]);
    expect(result.exitCode).not.toBe(0);
    expect(result.requests.filter((request) => request.path === "/v1/tasks")).toEqual([]);
  });

  test("still forwards a valid status to the authority and prints the rows", async () => {
    const result = await runRemote(["list", "--status", "pending", "--json"], [remoteTask()]);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as unknown[]).length).toBe(1);
    const taskRequests = result.requests.filter((request) => request.path === "/v1/tasks");
    expect(taskRequests.length).toBeGreaterThan(0);
    expect(taskRequests[0]!.query).toContain("status=pending");
  });

  test("forwards a canonicalised status, so a capitalised value is not sent raw", async () => {
    const result = await runRemote(["list", "--status", "Pending", "--json"], [remoteTask()]);
    expect(result.exitCode).toBe(0);
    const taskRequests = result.requests.filter((request) => request.path === "/v1/tasks");
    expect(taskRequests.length).toBeGreaterThan(0);
    expect(taskRequests[0]!.query).toContain("status=pending");
    expect(taskRequests[0]!.query).not.toContain("Pending");
  });
});

describe("todos search rejects out-of-vocabulary enum filters", () => {
  test("exits non-zero for an unknown --status instead of an empty search", async () => {
    const root = tempRoot("todos-enum-search-status-");
    await seedLocal(root);
    const result = await runLocal(["search", "fixture", "--status", "open"], root);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("No tasks matching");
    for (const status of TASK_STATUSES) expect(result.stderr).toContain(status);
  });

  test("exits non-zero for an unknown --priority instead of an empty search", async () => {
    const root = tempRoot("todos-enum-search-prio-");
    await seedLocal(root);
    const result = await runLocal(["search", "fixture", "--priority", "totally_bogus_value"], root);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("No tasks matching");
  });

  test("still returns matches for a valid status filter", async () => {
    const root = tempRoot("todos-enum-search-valid-");
    await seedLocal(root);
    const result = await runLocal(["search", "fixture", "--status", "pending", "--json"], root);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as unknown[]).length).toBe(2);
  });

  test("exits non-zero for an unknown --scope instead of silently searching tasks", async () => {
    const root = tempRoot("todos-enum-search-scope-");
    await seedLocal(root);
    const result = await runLocal(["search", "fixture", "--scope", "totally_bogus_value"], root);
    expect(result.exitCode).not.toBe(0);
  });
});

describe("write flags reject out-of-vocabulary enums", () => {
  test("todos add --status junk exits non-zero and creates nothing", async () => {
    const root = tempRoot("todos-enum-add-");
    const result = await runLocal(["add", "Should not exist", "--status", "totally_bogus_value"], root);
    expect(result.exitCode).not.toBe(0);
    const listing = await runLocal(["list", "-a", "--json"], root);
    expect((JSON.parse(listing.stdout) as unknown[]).length).toBe(0);
  });

  test("todos add --priority junk exits non-zero and names the allowed priorities", async () => {
    const root = tempRoot("todos-enum-add-prio-");
    const result = await runLocal(["add", "Should not exist", "--priority", "totally_bogus_value"], root);
    expect(result.exitCode).not.toBe(0);
    for (const priority of TASK_PRIORITIES) expect(result.stderr).toContain(priority);
  });

  test("todos add --status accepts a capitalised value", async () => {
    const root = tempRoot("todos-enum-add-case-");
    const result = await runLocal(["add", "Capitalised status", "--status", "In_Progress", "--json"], root);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as { status: string }).status).toBe("in_progress");
  });
});

describe("other closed-vocabulary filters found by the flag audit", () => {
  test("dispatches --status rejects a value outside DISPATCH_STATUSES", async () => {
    const root = tempRoot("todos-enum-dispatches-");
    const result = await runLocal(["dispatches", "--status", "totally_bogus_value"], root);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("No dispatches found.");
    for (const status of DISPATCH_STATUSES) expect(result.stderr).toContain(status);
  });

  test("dispatches --status still accepts a valid dispatch status", async () => {
    const root = tempRoot("todos-enum-dispatches-ok-");
    const result = await runLocal(["dispatches", "--status", "pending"], root);
    expect(result.exitCode).toBe(0);
  });

  test("export --format rejects an unknown format instead of silently emitting JSON", async () => {
    const root = tempRoot("todos-enum-export-");
    await seedLocal(root);
    const result = await runLocal(["export", "--format", "totally_bogus_value"], root);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  test("export --format md still produces markdown, not JSON", async () => {
    const root = tempRoot("todos-enum-export-md-");
    await seedLocal(root);
    const result = await runLocal(["export", "--format", "md"], root);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.startsWith("[")).toBe(false);
    expect(result.stdout).toContain("schema: hasna.todos.md/v1");
  });

  test("export --format json still produces JSON", async () => {
    const root = tempRoot("todos-enum-export-json-");
    await seedLocal(root);
    const result = await runLocal(["export", "--format", "json"], root);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as unknown[]).length).toBe(2);
  });
});

describe("commands that emit only through output() print in human mode", () => {
  test("projects --show prints the project on stdout without --json", async () => {
    const root = tempRoot("todos-output-projects-show-");
    const added = await runLocal(["projects", "--add", root, "--name", "Enum Fixture Project"], root);
    expect(added.exitCode).toBe(0);
    const result = await runLocal(["projects", "--show", "Enum Fixture Project"], root);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
    expect(result.stdout).toContain("Enum Fixture Project");
  });

  test("projects --update confirms the write on stdout without --json", async () => {
    const root = tempRoot("todos-output-projects-update-");
    await runLocal(["projects", "--add", root, "--name", "Enum Fixture Project"], root);
    const result = await runLocal(["projects", "--update", "Enum Fixture Project", "--description", "updated by test"], root);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
    expect(result.stdout).toContain("updated by test");
  });

  test("lists --show prints the task list on stdout without --json", async () => {
    const root = tempRoot("todos-output-lists-show-");
    const created = await runLocal(["lists", "--add", "Enum Fixture List", "--json"], root);
    expect(created.exitCode).toBe(0);
    const listId = (JSON.parse(created.stdout) as { id: string }).id;
    const result = await runLocal(["lists", "--show", listId], root);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
    expect(result.stdout).toContain("Enum Fixture List");
  });

  test("lists --update confirms the write on stdout without --json", async () => {
    const root = tempRoot("todos-output-lists-update-");
    const created = await runLocal(["lists", "--add", "Enum Fixture List", "--json"], root);
    const listId = (JSON.parse(created.stdout) as { id: string }).id;
    const result = await runLocal(["lists", "--update", listId, "--description", "updated by test"], root);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
    expect(result.stdout).toContain("updated by test");
  });

  test("projects --show --json still emits parseable JSON only", async () => {
    const root = tempRoot("todos-output-projects-json-");
    await runLocal(["projects", "--add", root, "--name", "Enum Fixture Project"], root);
    const result = await runLocal(["projects", "--show", "Enum Fixture Project", "--json"], root);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as { name: string }).name).toBe("Enum Fixture Project");
  });
});
