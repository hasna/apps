/**
 * `todos doctor` against a REMOTE /v1 authority — the mode the live dataset runs
 * in, and the one that used to return a hardcoded `ok: true`.
 *
 * On the unfixed source the first two cases here fail: doctor exited 0 with three
 * green check marks whether or not the authority held unbound task lists, because
 * the verdict was a literal and the task-list/project collections it fetched were
 * reduced to `.length`.
 *
 * Every case drives the real CLI against a fixture HTTP authority and asserts the
 * exit code UNPIPED, plus which routes were actually called. No local database may
 * be created on any of these paths.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(60_000);

const CWD = join(import.meta.dir, "../..");
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const LIST_BOUND = "22222222-2222-4222-8222-222222222222";
const LIST_UNBOUND = "33333333-3333-4333-8333-333333333333";
const GHOST_PROJECT = "99999999-9999-4999-8999-999999999999";

let testRoot = "";

interface CliResult { stdout: string; stderr: string; exitCode: number }

interface FixtureOptions {
  /** Task lists the authority returns. */
  taskLists: Array<{ id: string; name: string; slug: string; project_id: string | null }>;
  /** Tasks the authority returns from GET /v1/tasks. */
  tasks?: Array<{ id: string; status: string; project_id: string | null; task_list_id: string | null }>;
  /** When set, the authority exposes GET /v1/integrity and returns this body. */
  integrity?: unknown;
  /**
   * Transport-level answer from GET /v1/integrity, instead of a body.
   *
   * Separates two cases doctor must NOT conflate: a route that is ABSENT
   * (404/501 — cannot measure, so the conditions are UNVERIFIED) from a route
   * that is PRESENT BUT BROKEN (500/malformed — a hard error). A broken
   * aggregate is not evidence of health.
   */
  integrityTransport?: "500" | "501" | "malformed" | "empty";
}

function startFixtureAuthority(options: FixtureOptions): { server: ReturnType<typeof Bun.serve>; requests: string[] } {
  const requests: string[] = [];
  const tasks = options.tasks ?? [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}${url.search}`);
      if (url.pathname === "/v1/stats") return Response.json({ tasks: tasks.length, tasks_all: tasks.length, projects: 1 });
      if (url.pathname === "/v1/projects") {
        return Response.json({ projects: [{ id: PROJECT_ID, name: "Fixture", slug: "fixture", path: "/workspace/fixture" }], count: 1 });
      }
      if (url.pathname === "/v1/task-lists") return Response.json({ task_lists: options.taskLists, count: options.taskLists.length });
      if (url.pathname === "/v1/plans") return Response.json({ plans: [], count: 0 });
      if (url.pathname === "/v1/integrity") {
        switch (options.integrityTransport) {
          case "500": return Response.json({ error: "internal" }, { status: 500 });
          case "501": return Response.json({ error: "not implemented" }, { status: 501 });
          case "malformed": return Response.json({ unexpected: "no conditions array here" });
          case "empty": return new Response("", { status: 200 });
          default: break;
        }
        if (options.integrity === undefined) return Response.json({ error: "unknown /v1 resource: integrity" }, { status: 404 });
        return Response.json(options.integrity);
      }
      if (url.pathname === "/v1/tasks") {
        const limit = Number(url.searchParams.get("limit") ?? tasks.length);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const page = tasks.slice(offset, offset + limit);
        return Response.json({ tasks: page, count: page.length, total: tasks.length });
      }
      return Response.json({ error: "route not present in fixture" }, { status: 404 });
    },
  });
  return { server, requests };
}

async function runRemoteCli(args: string[], port: number): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: CWD,
    env: {
      PATH: process.env["PATH"] ?? "",
      BUN_INSTALL: process.env["BUN_INSTALL"] ?? join(process.env["HOME"] ?? "/home/hasna", ".bun"),
      HOME: join(testRoot, "home"),
      TMPDIR: testRoot,
      LANG: "C.UTF-8",
      TODOS_AUTO_PROJECT: "false",
      TODOS_DB_PATH: join(testRoot, "must-not-exist", "todos.db"),
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: `http://127.0.0.1:${port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // A remote command must never fall back to a local SQLite database.
  expect(existsSync(join(testRoot, "must-not-exist"))).toBe(false);
  return { stdout, stderr, exitCode };
}

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), "todos-doctor-remote-"));
  mkdirSync(join(testRoot, "home"), { recursive: true });
});

afterAll(() => rmSync(testRoot, { recursive: true, force: true }));

describe("todos doctor against a remote /v1 authority", () => {
  test("REGRESSION: an authority with no aggregate route exits 2 (incomplete), not 0 with green check marks", async () => {
    const { server, requests } = startFixtureAuthority({
      taskLists: [{ id: LIST_BOUND, name: "Bound", slug: "bound", project_id: PROJECT_ID }],
    });
    try {
      const result = await runRemoteCli(["doctor"], server.port);

      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 2, stderr: "" });
      expect(result.stdout).toContain("INCOMPLETE");
      // The two conditions derivable from rows doctor already fetches ARE checked.
      expect(result.stdout).toMatch(/task_lists_without_project 0/);
      expect(result.stdout).toMatch(/task_lists_with_unregistered_project 0/);
      // The task-level ones are honestly reported as not measured.
      for (const id of ["tasks_without_project", "tasks_without_task_list", "tasks_with_unregistered_project", "tasks_with_unregistered_task_list"]) {
        expect(result.stdout).toMatch(new RegExp(`${id} NOT CHECKED`));
      }
      expect(result.stdout).toContain("--scan-tasks");
      expect(requests).toContain("GET /v1/integrity");
      // Without --scan-tasks doctor must not page the task set.
      expect(requests.some((entry) => entry.startsWith("GET /v1/tasks?"))).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("REGRESSION: an unbound task list makes doctor exit 1 with a per-condition breakdown", async () => {
    const { server } = startFixtureAuthority({
      taskLists: [
        { id: LIST_BOUND, name: "Bound", slug: "bound", project_id: PROJECT_ID },
        { id: LIST_UNBOUND, name: "Unbound", slug: "unbound", project_id: null },
        { id: "44444444-4444-4444-8444-444444444444", name: "Ghost ref", slug: "ghost-ref", project_id: GHOST_PROJECT },
      ],
    });
    try {
      const result = await runRemoteCli(["--json", "doctor"], server.port);
      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 1, stderr: "" });

      const report = JSON.parse(result.stdout) as {
        ok: boolean;
        exit_code: number;
        integrity: {
          source: string;
          summary: { ok: boolean; findings: number; rows: number; unverified: number; complete: boolean };
          conditions: Array<{ id: string; count: number | null; verified: boolean; severity: string | null }>;
        };
      };
      expect(report.ok).toBe(false);
      expect(report.exit_code).toBe(1);
      expect(report.integrity.summary).toMatchObject({ ok: false, findings: 2, rows: 2, unverified: 4, complete: false });
      const byId = new Map(report.integrity.conditions.map((condition) => [condition.id, condition]));
      expect(byId.get("task_lists_without_project")).toMatchObject({ count: 1, severity: "warn", verified: true });
      expect(byId.get("task_lists_with_unregistered_project")).toMatchObject({ count: 1, severity: "error", verified: true });
      expect(byId.get("tasks_without_project")).toMatchObject({ count: null, verified: false });
    } finally {
      server.stop(true);
    }
  });

  test("--scan-tasks derives every task condition from a read-only paged walk", async () => {
    const { server, requests } = startFixtureAuthority({
      taskLists: [{ id: LIST_BOUND, name: "Bound", slug: "bound", project_id: PROJECT_ID }],
      tasks: [
        { id: "aaaaaaaa-0000-4000-8000-000000000001", status: "completed", project_id: PROJECT_ID, task_list_id: LIST_BOUND },
        { id: "aaaaaaaa-0000-4000-8000-000000000002", status: "pending", project_id: null, task_list_id: null },
        { id: "aaaaaaaa-0000-4000-8000-000000000003", status: "in_progress", project_id: GHOST_PROJECT, task_list_id: "55555555-5555-4555-8555-555555555555" },
      ],
    });
    try {
      const result = await runRemoteCli(["--json", "doctor", "--scan-tasks"], server.port);
      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 1, stderr: "" });

      const report = JSON.parse(result.stdout) as {
        integrity: { summary: { unverified: number; findings: number }; conditions: Array<{ id: string; count: number | null; open_count: number | null; source: string }> };
        scan: { complete: boolean; scanned: number; total: number; pages: number };
      };
      expect(report.scan).toMatchObject({ complete: true, scanned: 3, total: 3 });
      expect(report.integrity.summary).toMatchObject({ unverified: 0, findings: 4 });
      const byId = new Map(report.integrity.conditions.map((condition) => [condition.id, condition]));
      expect(byId.get("tasks_without_project")).toMatchObject({ count: 1, open_count: 1, source: "remote-scan" });
      expect(byId.get("tasks_without_task_list")).toMatchObject({ count: 1, open_count: 1 });
      expect(byId.get("tasks_with_unregistered_project")).toMatchObject({ count: 1, open_count: 1 });
      expect(byId.get("tasks_with_unregistered_task_list")).toMatchObject({ count: 1, open_count: 1 });
      // Subtasks must be included, or the walk under-reports.
      expect(requests.some((entry) => entry.includes("include_subtasks=true"))).toBe(true);
      // Read-only: no write ever leaves the CLI on this path.
      expect(requests.every((entry) => entry.startsWith("GET "))).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("prefers the authority aggregate when GET /v1/integrity exists, and does not page tasks", async () => {
    const authorityReport = {
      integrity: {
        schema_version: "todos.integrity.v1",
        generated_at: "2026-07-27T00:00:00.000Z",
        source: "postgres",
        conditions: [
          {
            id: "tasks_without_project", entity: "task", field: "project_id", kind: "missing",
            count: 10_176, open_count: 4_735, severity: "error", verified: true, source: "postgres",
            message: "10176 tasks have no project_id (4735 still open)", impact: "invisible to every project-scoped read",
          },
        ],
        summary: { ok: false, findings: 1, rows: 10_176, errors: 1, warnings: 0, unverified: 0, complete: true },
      },
    };
    const { server, requests } = startFixtureAuthority({
      taskLists: [{ id: LIST_UNBOUND, name: "Unbound", slug: "unbound", project_id: null }],
      integrity: authorityReport,
    });
    try {
      const result = await runRemoteCli(["--json", "doctor"], server.port);
      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 1, stderr: "" });

      const report = JSON.parse(result.stdout) as { ok: boolean; integrity: { source: string; summary: { rows: number } } };
      // The authority's own counts are the sole source — no client-side second opinion.
      expect(report.integrity.source).toBe("postgres");
      expect(report.integrity.summary.rows).toBe(10_176);
      expect(report.ok).toBe(false);
      expect(requests.some((entry) => entry.startsWith("GET /v1/tasks?"))).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("does NOT trust an authority that claims ok while reporting non-zero counts", async () => {
    // Hardening against the same bug arriving over HTTP: the counts are adopted,
    // the verdict is recomputed locally from those counts.
    const lyingAuthority = {
      integrity: {
        schema_version: "todos.integrity.v1",
        generated_at: "2026-07-27T00:00:00.000Z",
        source: "postgres",
        conditions: [
          {
            id: "tasks_without_project", entity: "task", field: "project_id", kind: "missing",
            count: 4_735, open_count: 4_735, severity: null, verified: true, source: "postgres",
            message: "nothing to see here", impact: "",
          },
        ],
        summary: { ok: true, findings: 0, rows: 0, errors: 0, warnings: 0, unverified: 0, complete: true },
      },
    };
    const { server } = startFixtureAuthority({ taskLists: [], integrity: lyingAuthority });
    try {
      const result = await runRemoteCli(["--json", "doctor"], server.port);
      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 1, stderr: "" });
      const report = JSON.parse(result.stdout) as {
        ok: boolean;
        integrity: { summary: { ok: boolean; findings: number; rows: number; unverified: number }; conditions: Array<{ id: string; count: number | null; severity: string | null }> };
      };
      expect(report.ok).toBe(false);
      expect(report.integrity.summary).toMatchObject({ ok: false, findings: 1, rows: 4_735 });
      // Severity is recomputed too: a null reference hiding open work is an error.
      expect(report.integrity.conditions.find((condition) => condition.id === "tasks_without_project")).toMatchObject({ severity: "error" });
      // A condition the authority did not report is NOT CHECKED, not absent.
      expect(report.integrity.summary.unverified).toBe(5);
      expect(report.integrity.conditions).toHaveLength(6);
    } finally {
      server.stop(true);
    }
  });

  test("refuses to treat a PARTIAL authority report as clean: 2 of 6 clean conditions still exits 2", async () => {
    // The emergent property worth pinning: an authority that reports only some
    // conditions — an older or newer build, or one whose backend answered part of
    // the set — must not shrink the checked set to whatever it happened to send.
    // Every count it did send is zero here, so nothing is a finding; the verdict is
    // INCOMPLETE, never clean.
    const partial = {
      integrity: {
        schema_version: "todos.integrity.v1",
        generated_at: "2026-07-27T00:00:00.000Z",
        source: "postgres",
        conditions: [
          { id: "tasks_without_project", count: 0, open_count: 0, verified: true, severity: null, source: "postgres", message: "0", impact: "" },
          { id: "task_lists_without_project", count: 0, open_count: null, verified: true, severity: null, source: "postgres", message: "0", impact: "" },
        ],
        summary: { ok: true, findings: 0, rows: 0, errors: 0, warnings: 0, unverified: 0, complete: true },
      },
    };
    const { server, requests } = startFixtureAuthority({ taskLists: [], integrity: partial });
    try {
      const human = await runRemoteCli(["doctor"], server.port);
      expect({ exitCode: human.exitCode, stderr: human.stderr }).toEqual({ exitCode: 2, stderr: "" });
      expect(human.stdout).toContain("INCOMPLETE");
      for (const id of ["tasks_without_task_list", "tasks_with_unregistered_project", "tasks_with_unregistered_task_list", "task_lists_with_unregistered_project"]) {
        expect(human.stdout).toContain(`${id} NOT CHECKED — authority did not report this condition`);
      }

      const json = await runRemoteCli(["--json", "doctor"], server.port);
      expect(json.exitCode).toBe(2);
      const report = JSON.parse(json.stdout) as {
        ok: boolean; exit_code: number; verdict_exit_code: number;
        integrity: { summary: { ok: boolean; findings: number; unverified: number; complete: boolean }; conditions: Array<{ id: string; count: number | null; verified: boolean }> };
      };
      expect(report).toMatchObject({ ok: false, exit_code: 2, verdict_exit_code: 2 });
      expect(report.integrity.summary).toMatchObject({ ok: false, findings: 0, unverified: 4, complete: false });
      expect(report.integrity.conditions).toHaveLength(6);
      expect(report.integrity.conditions.filter((condition) => condition.count === null)).toHaveLength(4);
      // A partial report must not send doctor off to page the whole task set either.
      expect(requests.some((entry) => entry.startsWith("GET /v1/tasks?"))).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("a clean authority aggregate exits 0", async () => {
    const conditions = [
      "tasks_without_project", "tasks_without_task_list", "tasks_with_unregistered_project",
      "tasks_with_unregistered_task_list", "task_lists_without_project", "task_lists_with_unregistered_project",
    ].map((id) => ({
      id, entity: id.startsWith("tasks") ? "task" : "task_list", field: "project_id", kind: "missing",
      count: 0, open_count: 0, severity: null, verified: true, source: "postgres", message: `${id}: 0`, impact: "n/a",
    }));
    const { server } = startFixtureAuthority({
      taskLists: [],
      integrity: {
        integrity: {
          schema_version: "todos.integrity.v1", generated_at: "2026-07-27T00:00:00.000Z", source: "postgres",
          conditions,
          summary: { ok: true, findings: 0, rows: 0, errors: 0, warnings: 0, unverified: 0, complete: true },
        },
      },
    });
    try {
      const result = await runRemoteCli(["doctor"], server.port);
      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(result.stdout).toContain("Integrity clean");
    } finally {
      server.stop(true);
    }
  });

  test("--apply against a remote authority still refuses before issuing any request", async () => {
    const { server, requests } = startFixtureAuthority({ taskLists: [] });
    try {
      const result = await runRemoteCli(["--json", "doctor", "--apply"], server.port);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("REMOTE_COMMAND_UNSUPPORTED");
      expect(requests).toEqual([]);
    } finally {
      server.stop(true);
    }
  });
});

/**
 * A BROKEN `/v1/integrity` must never read as healthy.
 *
 * Every fixture here serves an otherwise CLEAN dataset — one bound task list, no
 * orphans — so a non-zero exit can only come from how the aggregate route failed,
 * never from findings. That is the whole point: on the unfixed source a clean
 * dataset exited 0 regardless, and the failure mode this batch exists to kill is a
 * check that reports success because it never actually ran.
 *
 * The distinction the assertions pin:
 *   - ABSENT route (404/501)      -> conditions UNVERIFIED, exit 2 (incomplete)
 *   - PRESENT but broken (500)    -> hard error, exit 1, no verdict printed
 *   - PRESENT but unparseable     -> hard error, exit 1, no verdict printed
 */
describe("todos doctor: a broken GET /v1/integrity never reads as clean", () => {
  const CLEAN_LISTS = [{ id: LIST_BOUND, name: "Bound", slug: "bound", project_id: PROJECT_ID }];

  test("501 Not Implemented is an ABSENT route: exit 2 with conditions UNVERIFIED, not exit 0", async () => {
    const { server, requests } = startFixtureAuthority({ taskLists: CLEAN_LISTS, integrityTransport: "501" });
    try {
      const result = await runRemoteCli(["doctor"], server.port);

      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 2, stderr: "" });
      expect(result.stdout).toContain("INCOMPLETE");
      for (const id of ["tasks_without_project", "tasks_without_task_list", "tasks_with_unregistered_project", "tasks_with_unregistered_task_list"]) {
        expect(result.stdout).toMatch(new RegExp(`${id} NOT CHECKED`));
      }
      expect(requests).toContain("GET /v1/integrity");
    } finally {
      server.stop(true);
    }
  });

  test("500 from the aggregate is a HARD ERROR, not a clean or incomplete verdict", async () => {
    const { server } = startFixtureAuthority({ taskLists: CLEAN_LISTS, integrityTransport: "500" });
    try {
      const result = await runRemoteCli(["doctor"], server.port);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("REMOTE_API_UNAVAILABLE");
      expect(result.stderr).toContain("/integrity");
      // A transport error must not be dressed up as a verdict about the data.
      expect(result.stdout).not.toContain("Integrity clean");
      expect(result.stdout).not.toContain("INCOMPLETE");
    } finally {
      server.stop(true);
    }
  });

  test("a 200 body with no condition breakdown is a HARD ERROR, not an empty clean report", async () => {
    const { server } = startFixtureAuthority({ taskLists: CLEAN_LISTS, integrityTransport: "malformed" });
    try {
      const result = await runRemoteCli(["doctor"], server.port);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("REMOTE_API_INCOMPATIBLE");
      expect(result.stdout).not.toContain("Integrity clean");
    } finally {
      server.stop(true);
    }
  });

  test("an empty 200 body is a HARD ERROR, not an empty clean report", async () => {
    const { server } = startFixtureAuthority({ taskLists: CLEAN_LISTS, integrityTransport: "empty" });
    try {
      const result = await runRemoteCli(["doctor"], server.port);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("REMOTE_API_INCOMPATIBLE");
      expect(result.stdout).not.toContain("Integrity clean");
    } finally {
      server.stop(true);
    }
  });
});
