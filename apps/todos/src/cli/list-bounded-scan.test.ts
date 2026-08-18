/**
 * `todos list` must not ask the authority for an UNBOUNDED task set (todos 9981b581).
 *
 * The defect this suite closes was introduced by the fix for the previous one, which
 * is why both halves are asserted here rather than only the new invariant.
 *
 * Correctness half (already fixed, guarded here against regression): storage orders by
 * `priority_rank, created_at DESC` and never by the requested field, so applying the
 * caller's `--limit` in storage drew the window from the WRONG ordering — `--sort
 * updated --limit 2` returned the two highest-priority rows sorted by update time, and
 * the row actually updated last could be absent, at exit 0. The remedy was to withhold
 * the limit from the query and take the window last.
 *
 * Boundedness half (the defect): withholding the limit removed the bound ENTIRELY.
 * `GET /v1/tasks` has no default limit — `src/server/routes.ts` reads
 * `limit: limitParam ? parseInt(limitParam, 10) : undefined` — so `todos list --sort
 * updated --limit 2` downloaded and materialised every matching task. Measured against
 * a recording stub on the unfixed head: the outgoing query was
 * `status=pending%2Cin_progress` with NO limit param, while the same command without
 * `--sort` sent `status=pending%2Cin_progress&limit=2`. That is the repository's own
 * documented O(all-tasks) download, reintroduced on the ordinary list path, at a
 * measured 3,250 pending tasks fleet-wide.
 *
 * Both must hold: the window is still taken after ordering, AND the request carries a
 * bound. The bound is a SCAN ceiling rather than the caller's limit, because a correct
 * global sort genuinely needs more rows than the caller asked to see — `/v1/tasks`
 * exposes no `sort` parameter, so the ordering cannot be delegated to the authority.
 * When that ceiling is reached the result may be drawn from a truncated scan, and the
 * command SAYS SO instead of silently returning a plausible window.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/schema.js";
import { createProject } from "../db/projects.js";
import { createTask } from "../db/tasks.js";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

setDefaultTimeout(30_000);

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_API_KEY = "[REDACTED_SECRET]";

type RemoteResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  taskQueries: string[];
};

/** A task whose `updated_at` increases with the index, served in index order. */
function stubTask(index: number): Record<string, unknown> {
  const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    short_id: `stub${index}`,
    title: `Stub task ${index}`,
    status: "pending",
    priority: "medium",
    created_at: stamp,
    updated_at: stamp,
  };
}

/**
 * Run the CLI against a stub hosted `/v1` authority that records every
 * query it is asked, and DELIBERATELY ignores `limit` — the assertion is about what
 * the client REQUESTS, so a stub that honoured the limit would hide the defect.
 *
 * `honorLimit` opts into the REAL server's response contract (`/v1/tasks` returns at
 * most `limit` rows with `total` = full match count), for tests that assert what the
 * CLI does with a truncating authority.
 */
async function runRemote(
  args: string[],
  rowCount: number,
  extraEnv: Record<string, string> = {},
  honorLimit = false,
): Promise<RemoteResult> {
  const tasks = Array.from({ length: rowCount }, (_, i) => stubTask(i));
  const taskQueries: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/v1/tasks") {
        taskQueries.push(url.searchParams.toString());
        const requested = url.searchParams.get("limit");
        const served = honorLimit && requested !== null
          ? tasks.slice(0, Number(requested))
          : tasks;
        return Response.json({ tasks: served, count: served.length, total: tasks.length });
      }
      if (url.pathname === "/v1/projects") return Response.json({ projects: [] });
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  const root = mkdtempSync(join(tmpdir(), "todos-scan-"));
  try {
    const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
      cwd: REPO_ROOT,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: join(root, "home"),
        TMPDIR: root,
        LANG: "C.UTF-8",
        TODOS_DB_PATH: join(root, "todos.db"),
        TODOS_AUTO_PROJECT: "false",
        HASNA_TODOS_API_URL: server.url.origin,
        HASNA_TODOS_API_KEY: TEST_API_KEY,
        ...extraEnv,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode, taskQueries };
  } finally {
    await server.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}

/** The `limit` the client actually put on the wire, or undefined when it sent none. */
function requestedLimit(query: string): number | undefined {
  const value = new URLSearchParams(query).get("limit");
  return value === null ? undefined : Number(value);
}

describe("todos list bounds every remote task query", () => {
  test.each([
    [["list", "--sort", "updated", "--limit", "2", "--json"], "--sort reorders after the query"],
    [["list", "--overdue", "--limit", "5", "--json"], "--overdue narrows after the query"],
    [["list", "--due-today", "--limit", "5", "--json"], "--due-today narrows after the query"],
  ])("sends a bounded limit for %o (%s)", async (args) => {
    const result = await runRemote(args as string[], 5);
    expect(result.exitCode).toBe(0);
    expect(result.taskQueries.length).toBeGreaterThan(0);
    const limit = requestedLimit(result.taskQueries[0]!);
    // The precise value is a policy detail; the invariant is that SOME bound is sent.
    // Unbounded is what downloads the whole task set.
    expect(limit).toBeDefined();
    expect(limit!).toBeGreaterThan(0);
  });

  /**
   * The control that keeps the case above honest. A query with no reorder/narrow step
   * still forwards the caller's own limit, so the assertion above is detecting the
   * withheld-limit path rather than agreeing with a CLI that happens to put a limit
   * on every request.
   *
   * The forwarded value is the caller's limit PLUS ONE (todos 52b0a207): when the
   * authority applies the limit itself, the extra row is a truncation probe — a page
   * of exactly `limit` rows from a `limit+1` request proves the matching set is
   * larger, which is how the command knows to emit its truncation signal instead of
   * answering with a silent round number.
   */
  test("forwards the caller's limit plus a one-row truncation probe when nothing reorders", async () => {
    const result = await runRemote(["list", "--status", "pending", "--limit", "2", "--json"], 5);
    expect(result.exitCode).toBe(0);
    expect(requestedLimit(result.taskQueries[0]!)).toBe(3);
  });

  /**
   * The case that carried no `--limit` at all was unbounded BEFORE this branch too, so
   * fixing only the withheld-limit path would have repaired the symptom the review
   * named while the same download stayed reachable one flag away. Bounding it is a
   * deliberate widening, recorded here so it is visible rather than incidental.
   */
  test("bounds a remote query that carried no caller limit at all", async () => {
    const result = await runRemote(["list", "--sort", "updated", "--json"], 5);
    expect(result.exitCode).toBe(0);
    expect(requestedLimit(result.taskQueries[0]!)).toBeDefined();
  });

  test("bounds a plain remote list with no limit and no sort", async () => {
    const result = await runRemote(["list", "--json"], 5);
    expect(result.exitCode).toBe(0);
    expect(requestedLimit(result.taskQueries[0]!)).toBeDefined();
  });

  test("never asks for fewer rows than the caller's own limit", async () => {
    const result = await runRemote(
      ["list", "--sort", "updated", "--limit", "50", "--json"],
      5,
      { TODOS_LIST_SCAN_LIMIT: "3" },
    );
    expect(result.exitCode).toBe(0);
    expect(requestedLimit(result.taskQueries[0]!)!).toBeGreaterThanOrEqual(50);
  });
});

describe("todos list reports a truncated scan instead of returning a silent window", () => {
  test("warns when the scan ceiling is reached", async () => {
    const result = await runRemote(
      ["list", "--sort", "updated", "--limit", "2", "--json"],
      3,
      { TODOS_LIST_SCAN_LIMIT: "3" },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("scan limit");
    expect(result.stderr).toContain("TODOS_LIST_SCAN_LIMIT");
  });

  /**
   * The negative half of the gate. A warning that fires whenever a scan cap exists
   * would be noise on every sorted list, and operators would learn to ignore exactly
   * the message that means their result is incomplete.
   */
  test("stays SILENT when the result set fits inside the ceiling", async () => {
    const result = await runRemote(
      ["list", "--sort", "updated", "--limit", "2", "--json"],
      2,
      { TODOS_LIST_SCAN_LIMIT: "3" },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("scan limit");
  });
});

describe("todos list still takes the window AFTER ordering", () => {
  /**
   * Guards the previous cycle's fix. The stub serves rows in ascending `updated_at`,
   * so the two most recently updated are the LAST two served. A client that truncated
   * before sorting would return "Stub task 0" and "Stub task 1".
   */
  test("--sort updated --limit 2 returns the two most recently updated rows", async () => {
    const result = await runRemote(["list", "--sort", "updated", "--limit", "2", "--json"], 6);
    expect(result.exitCode).toBe(0);
    const titles = (JSON.parse(result.stdout) as Array<{ title: string }>).map((t) => t.title);
    expect(titles).toEqual(["Stub task 5", "Stub task 4"]);
  });
});

describe("todos list makes a bounded read distinguishable from the full population (todos 52b0a207)", () => {
  /**
   * The defect: `--limit N` against a population larger than N answered with exactly
   * N rows, rc=0, and no signal — a bounded read was indistinguishable from the full
   * population (the round-number tell). These tests assert the truncation signal.
   * It goes to STDERR so `--json` stdout stays a clean parseable array, matching the
   * scan-ceiling warning's established channel.
   */

  test("warns on stderr when the caller's own limit truncates a forwarded read", async () => {
    const result = await runRemote(
      ["list", "--status", "pending", "--limit", "2", "--json"],
      5,
      {},
      true,
    );
    expect(result.exitCode).toBe(0);
    const rows = JSON.parse(result.stdout) as unknown[];
    expect(rows.length).toBe(2);
    expect(result.stderr).toContain("more than --limit 2");
    // The JSON surface stays a bare array — no envelope was introduced.
    expect(result.stdout.trimStart().startsWith("[")).toBe(true);
  });

  test("stays SILENT when the full population fits inside the caller's limit", async () => {
    const result = await runRemote(
      ["list", "--status", "pending", "--limit", "5", "--json"],
      5,
      {},
      true,
    );
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as unknown[]).length).toBe(5);
    expect(result.stderr).not.toContain("more than --limit");
  });

  test("warns when the caller's limit truncates a client-side window (--sort)", async () => {
    const result = await runRemote(["list", "--sort", "updated", "--limit", "2", "--json"], 5);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as unknown[]).length).toBe(2);
    expect(result.stderr).toContain("more than --limit 2");
  });

  test("stays SILENT when a client-side window covers the full population", async () => {
    const result = await runRemote(["list", "--sort", "updated", "--limit", "5", "--json"], 5);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as unknown[]).length).toBe(5);
    expect(result.stderr).not.toContain("more than --limit");
  });
});

describe("todos list truncation signal on the local SQLite store (todos 52b0a207)", () => {
  /**
   * The same silent-cap defect exists on the local store: `LIMIT N` in SQL answers
   * with exactly N rows and nothing else. The +1 probe applies there too — SQL
   * `LIMIT N+1` — so the local path must warn identically.
   */
  async function runLocal(
    args: string[],
    taskCount: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const root = mkdtempSync(join(tmpdir(), "todos-local-trunc-"));
    const dbPath = join(root, "todos.db");
    const db = new Database(dbPath);
    try {
      runMigrations(db);
      const project = createProject({ name: "TruncLocal", path: join(root, "proj") }, db);
      db.transaction(() => {
        for (let i = 0; i < taskCount; i += 1) {
          createTask({
            title: `Local task ${i}`,
            project_id: project.id,
            status: "pending",
            priority: "medium",
          }, db);
        }
      })();
    } finally {
      db.close();
    }
    try {
      const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
        cwd: REPO_ROOT,
        env: localRoutingTestEnv({
          HOME: join(root, "home"),
          TMPDIR: root,
          TODOS_DB_PATH: dbPath,
          TODOS_AUTO_PROJECT: "false",
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
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test("warns when the caller's limit truncates the local read", async () => {
    const result = await runLocal(["list", "--status", "pending", "--limit", "2", "--json"], 5);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as unknown[]).length).toBe(2);
    expect(result.stderr).toContain("more than --limit 2");
  });

  test("stays SILENT when the local population fits inside the caller's limit", async () => {
    const result = await runLocal(["list", "--status", "pending", "--limit", "5", "--json"], 5);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as unknown[]).length).toBe(5);
    expect(result.stderr).not.toContain("more than --limit");
  });
});
