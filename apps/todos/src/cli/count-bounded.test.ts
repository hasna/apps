/**
 * `todos count` must not download the whole task set to count it (task 5e5ed4d1).
 *
 * Measured 2026-08-19 against the hosted authority (todos.hasna.xyz): an UNBOUNDED
 * `GET /v1/tasks` returns the full matching set — 64,870 rows / ~154 MB in ~22 s —
 * while bounded reads (`limit=N`) answer in ~1.1 s. The published CLI (0.15.35)
 * carries a ~10 s client timeout, so `todos count` — which asked for the unbounded
 * shape and counted rows client-side — failed with `REMOTE_API_TIMEOUT`, a timeout
 * that reads as API-down even though bounded reads from the same authority are fast.
 *
 * The fix: `todos count` asks for a bounded, count-specific shape. The /v1 server
 * returns the SQL-side full-match `total` on ANY page, so count issues one bounded
 * (`limit=1`) request per status plus the unfiltered total, and derives the counts
 * from `total` — never downloading the population. This suite asserts exactly that:
 * every `/v1/tasks` request carries a `limit`, and the reported counts equal the
 * authority's `total`, even when the authority serves only one row per page.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliverTodosApiKeyViaDisk } from "../testing.js";

setDefaultTimeout(30_000);

const REPO_ROOT = join(import.meta.dir, "../..");
/** Synthetic fixture for the test authority; not a real credential. */
const TEST_AUTHORITY = "fixture-todos-test-key";

/** Matching the hosted dataset measured 2026-08-19; any large population works. */
const STUB_TOTALS: Record<string, number> = {
  all: 64870,
  pending: 8582,
  in_progress: 533,
  completed: 31699,
  failed: 1073,
  cancelled: 22984,
};
// The five statuses `todos count` displays, in output order of the JSON shape.
const COUNTED_STATUSES = ["pending", "in_progress", "completed", "failed", "cancelled"] as const;

type RemoteResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  taskQueries: string[];
};

function stubTask(): Record<string, unknown> {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    short_id: "stub1",
    title: "Stub task",
    status: "pending",
    priority: "medium",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Run the CLI against a stub `/v1` authority that serves ONE task per page while
 * reporting the large SQL-side `total`, and records every query it is asked. If the
 * client asks for the unbounded shape and counts rows, it gets 1 — the wrong answer
 * for a 64,870-task dataset — and the recorded query hides the defect (no limit).
 */
async function runRemote(args: string[]): Promise<RemoteResult> {
  const taskQueries: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/v1/tasks") {
        taskQueries.push(url.searchParams.toString());
        const status = url.searchParams.get("status");
        const total = status ? (STUB_TOTALS[status] ?? 0) : STUB_TOTALS.all;
        return Response.json({ tasks: [stubTask()], count: 1, total });
      }
      if (url.pathname === "/v1/projects") return Response.json({ projects: [] });
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  const root = mkdtempSync(join(tmpdir(), "todos-count-"));
  try {
    const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
      cwd: REPO_ROOT,
      env: deliverTodosApiKeyViaDisk({
        PATH: process.env.PATH ?? "",
        HOME: join(root, "home"),
        TMPDIR: root,
        LANG: "C.UTF-8",
        TODOS_DB_PATH: join(root, "todos.db"),
        TODOS_AUTO_PROJECT: "false",
        HASNA_TODOS_API_URL: server.url.origin,
        HASNA_TODOS_API_KEY: TEST_AUTHORITY,
}),
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

describe("todos count against the remote /v1 authority", () => {
  test("every /v1/tasks request is bounded (limit present) — no O(all-tasks) download", async () => {
    const res = await runRemote(["count", "--json"]);
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe("");
    // The count must ask for a bounded shape on every request, including the
    // unfiltered one. An unbounded request (no `limit` param) is the defect.
    expect(res.taskQueries.length).toBeGreaterThan(0);
    for (const query of res.taskQueries) {
      expect(new URLSearchParams(query).get("limit")).toBe("1");
    }
  });

  test("asks exactly the unfiltered total plus one bounded request per displayed status", async () => {
    const res = await runRemote(["count", "--json"]);
    const statuses = res.taskQueries.map((q) => new URLSearchParams(q).get("status"));
    expect(statuses).toHaveLength(1 + COUNTED_STATUSES.length);
    expect(statuses.filter((s) => s === null)).toHaveLength(1); // unfiltered total
    for (const status of COUNTED_STATUSES) {
      expect(statuses).toContain(status);
    }
  });

  test("reports the authority's SQL-side total, not the downloaded row count", async () => {
    const res = await runRemote(["count", "--json"]);
    expect(res.exitCode).toBe(0);
    const counts = JSON.parse(res.stdout) as Record<string, number>;
    // Only ONE row is served per page, so any count derived client-side from the
    // downloaded tasks would be 1. Equality with the stub `total` proves the count
    // used the bounded, server-side count.
    expect(counts.total).toBe(STUB_TOTALS.all);
    for (const status of COUNTED_STATUSES) {
      expect(counts[status]).toBe(STUB_TOTALS[status]);
    }
  });
});
