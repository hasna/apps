/**
 * Remote authorities predating multi-value enum filters accept scalar statuses but
 * silently return an empty list for `status=pending,in_progress`. The ordinary
 * no-status CLI path must therefore compose the two supported scalar reads instead
 * of trusting that ambiguous empty response.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(30_000);

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_API_KEY = "[REDACTED_SECRET]";
const ASSIGNEE = "agent-chief-engineering";

type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  statusQueries: string[];
  requestedLimits: Array<number | undefined>;
};

function task(
  id: string,
  status: "pending" | "in_progress",
  priority: "critical" | "high",
  createdAt = status === "pending" ? "2026-08-08T07:00:00.000Z" : "2026-08-08T08:00:00.000Z",
) {
  return {
    id,
    short_id: id.slice(0, 8),
    title: `${status} task`,
    status,
    priority,
    assigned_to: ASSIGNEE,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

const ROWS = {
  pending: [task("11111111-1111-4111-8111-111111111111", "pending", "high")],
  in_progress: [task("22222222-2222-4222-8222-222222222222", "in_progress", "critical")],
};

const SAME_PRIORITY_ROWS = {
  pending: [
    task("44444444-4444-4444-8444-444444444444", "pending", "high", "2026-08-08T07:00:00.000Z"),
    task("66666666-6666-4666-8666-666666666666", "pending", "high", "2026-08-08T11:00:00.000Z"),
  ],
  in_progress: [
    task("55555555-5555-4555-8555-555555555555", "in_progress", "high", "2026-08-08T08:00:00.000Z"),
    task("77777777-7777-4777-8777-777777777777", "in_progress", "high", "2026-08-08T10:00:00.000Z"),
  ],
};

async function runRemote(args: string[], fixture = ROWS): Promise<CliResult> {
  const statusQueries: string[] = [];
  const requestedLimits: Array<number | undefined> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/v1/tasks") {
        const status = url.searchParams.get("status") ?? "";
        const limitValue = url.searchParams.get("limit");
        const limit = limitValue === null ? undefined : Number.parseInt(limitValue, 10);
        statusQueries.push(status);
        requestedLimits.push(limit);
        const matchingTasks = status === "pending"
          ? fixture.pending
          : status === "in_progress"
            ? fixture.in_progress
            : [];
        // The current PostgreSQL authority orders equal-priority scalar pages
        // oldest-first. Enforce the requested limit so the fixture exposes rows
        // discarded before the client can restore the global newest-first order.
        const tasks = [...matchingTasks]
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .slice(0, limit);
        return Response.json({ tasks, count: tasks.length, total: tasks.length });
      }
      if (url.pathname === "/v1/agents") {
        return Response.json({
          agents: [{ id: "33333333-3333-4333-8333-333333333333", name: ASSIGNEE, status: "active" }],
        });
      }
      if (url.pathname === "/v1/projects") return Response.json({ projects: [] });
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  const root = mkdtempSync(join(tmpdir(), "todos-no-status-union-"));
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
        HASNA_TODOS_STORAGE_MODE: "self_hosted",
        HASNA_TODOS_API_URL: server.url.origin,
        HASNA_TODOS_API_KEY: TEST_API_KEY,
        TODOS_LIST_SCAN_LIMIT: "101",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode, statusQueries, requestedLimits };
  } finally {
    await server.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}

function rows(result: CliResult): Array<{ id: string }> {
  return JSON.parse(result.stdout) as Array<{ id: string }>;
}

function ids(result: CliResult): string[] {
  return rows(result).map((row) => row.id).sort();
}

describe("remote todos list without --status", () => {
  test("returns the union of the two scalar status reads", async () => {
    const [combined, pending, inProgress] = await Promise.all([
      runRemote(["--json", "list", "--assigned", ASSIGNEE]),
      runRemote(["--json", "list", "--assigned", ASSIGNEE, "--status", "pending"]),
      runRemote(["--json", "list", "--assigned", ASSIGNEE, "--status", "in_progress"]),
    ]);

    expect(combined).toMatchObject({ exitCode: 0, stderr: "" });
    expect(ids(combined)).toEqual([...ids(pending), ...ids(inProgress)].sort());
    expect(rows(combined).map((row) => row.id)).toEqual([
      ROWS.in_progress[0]!.id,
      ROWS.pending[0]!.id,
    ]);
    expect(combined.statusQueries.sort()).toEqual(["in_progress", "pending"]);
  });

  test("globally orders the scalar union before applying --limit", async () => {
    const limited = await runRemote([
      "--json", "list", "--assigned", ASSIGNEE, "--limit", "1",
    ]);

    expect(limited).toMatchObject({ exitCode: 0, stderr: "" });
    expect(rows(limited).map((row) => row.id)).toEqual([ROWS.in_progress[0]!.id]);
    expect(limited.statusQueries.sort()).toEqual(["in_progress", "pending"]);
  });

  test("orders equal-priority tasks by newest creation time before applying --limit", async () => {
    const limited = await runRemote([
      "--json", "list", "--assigned", ASSIGNEE, "--limit", "1",
    ], SAME_PRIORITY_ROWS);

    expect(limited).toMatchObject({ exitCode: 0, stderr: "" });
    expect(rows(limited).map((row) => row.id)).toEqual([SAME_PRIORITY_ROWS.pending[1]!.id]);
    expect(limited.statusQueries.sort()).toEqual(["in_progress", "pending"]);
    expect(limited.requestedLimits).toEqual([101, 101]);
  });

  test("keeps an explicit scalar status as one scalar request", async () => {
    const pending = await runRemote([
      "--json", "list", "--assigned", ASSIGNEE, "--status", "pending",
    ]);

    expect(pending).toMatchObject({ exitCode: 0, stderr: "", statusQueries: ["pending"] });
    expect(ids(pending)).toEqual([ROWS.pending[0]!.id]);
  });
});
