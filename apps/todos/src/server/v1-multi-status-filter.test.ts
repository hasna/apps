/**
 * Regression for todos task 0d4fccd1: `todos list --json` answered `[]` — 200,
 * empty stderr, and a human render reading "No tasks found." — on a project
 * holding 546 pending rows.
 *
 * The discriminator is ARRAY vs STRING status, not `--json`. With no `--status`
 * and no `--all`, the CLI defaults `filter.status` to the ARRAY
 * `["pending", "in_progress"]` (src/cli/commands/task-commands.ts), which
 * `toListQuery` (src/cli/cloud-router.ts) serializes to the comma-separated
 * `status=pending,in_progress`. Passing `--status pending` sends a bare string
 * instead, which is why the workaround appeared to "fix" the read.
 *
 * The storage layer has always supported a multi-status filter — `status IN (?,?)`
 * in src/db/task-crud.ts — so the capability existed at both ends and only the
 * `/v1/tasks` route decided whether it was reachable. Measured against the hosted
 * authority on 2026-08-08, where the comma-separated form behaved exactly like a
 * value that is in no vocabulary at all:
 *
 *     status=pending                  http=200 rows=5
 *     status=pending%2Cin_progress    http=200 rows=0
 *     status=in_progress              http=200 rows=5
 *     status=totally_bogus_status     http=200 rows=0
 *
 * WHAT THIS TEST ASSERTS, AND WHY IT IS NOT "RETURNS NON-EMPTY". A test that only
 * checked that the bare form returns rows would pass on a single-status fixture
 * and would not have caught this: the defect is that a multi-status filter
 * silently answers a DIFFERENT question than the one asked. So every case below
 * fixes the answer against the union of the corresponding single-status queries,
 * on a fixture carrying rows in all five statuses with distinct per-status counts.
 * That pins the result to an exact set and fails on both sides — a filter that
 * drops an element, and a filter that is ignored and returns the whole table.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import { handleV1Request, type V1RequestDependencies } from "./v1.js";
import { createLocalPrGroupLedger } from "../pr-groups/index.js";
import { TASK_STATUSES } from "../types/index.js";

let db: Database;
let store: TodosStorageAdapter;
let dependencies: V1RequestDependencies;

function request(path: string, method = "GET", body?: unknown): Promise<Response | null> {
  const url = new URL(`https://todos.example.test${path}`);
  return handleV1Request(new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), url, dependencies);
}

interface TaskPage {
  tasks: Array<{ title: string; status: string }>;
  count: number;
  total: number;
}

/** Titles returned by `GET /v1/tasks?<query>`, sorted so comparison is order-free. */
async function titlesFor(query: string): Promise<string[]> {
  const response = await request(`/v1/tasks?${query}`);
  expect(response?.status).toBe(200);
  const page = await response!.json() as TaskPage;
  // `count` and `total` must agree with the page itself, or a caller paginating
  // on `total` reads a different population than the one it was handed.
  expect(page.count).toBe(page.tasks.length);
  expect(page.total).toBe(page.tasks.length);
  return page.tasks.map((task) => task.title).sort();
}

/**
 * Distinct row counts per status, so a filter that returns the wrong subset
 * cannot coincidentally match the expected size. 1+2+3+4+5 = 15 rows total.
 */
const FIXTURE: ReadonlyArray<readonly [string, number]> = [
  ["pending", 1],
  ["in_progress", 2],
  ["completed", 3],
  ["failed", 4],
  ["cancelled", 5],
];

beforeEach(async () => {
  resetDatabase();
  db = getDatabase(":memory:");
  store = createLocalSqliteTodosStorageAdapter({ db });
  dependencies = {
    ensureSchema: async () => {},
    getStorageAdapter: () => store,
    getPrGroupLedger: () => createLocalPrGroupLedger(db),
    getVerifier: () => ({
      authenticate: async () => ({ ok: true, principal: { agent: null, scopes: ["todos:*"] } }),
    }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
  };

  for (const [status, count] of FIXTURE) {
    for (let i = 0; i < count; i += 1) {
      const created = await request("/v1/tasks", "POST", { title: `${status}-${i}` });
      expect(created?.status).toBe(201);
      const task = await created!.json() as { task: { id: string } };
      if (status !== "pending") {
        const patched = await request(`/v1/tasks/${task.task.id}`, "PATCH", { status });
        expect(patched?.status).toBe(200);
      }
    }
  }
});

afterEach(() => resetDatabase());

describe("GET /v1/tasks multi-status filtering", () => {
  test("the fixture really does span every status, or the rest of this file proves nothing", async () => {
    for (const [status, count] of FIXTURE) {
      expect(await titlesFor(`status=${status}`)).toHaveLength(count);
    }
    expect(await titlesFor("limit=100")).toHaveLength(15);
  });

  test("the CLI's default filter returns pending UNION in_progress — not zero, not everything", async () => {
    // This is the exact query the bare `todos list` emits: no --status, no --all.
    const combined = await titlesFor("status=pending,in_progress");
    const union = [...await titlesFor("status=pending"), ...await titlesFor("status=in_progress")].sort();

    expect(combined).toEqual(union);
    expect(combined).toHaveLength(3);
    // Guard both failure directions explicitly: the measured defect (a confident
    // zero) and its mirror (an ignored filter returning the whole table).
    expect(combined.length).toBeGreaterThan(0);
    expect(combined.length).toBeLessThan(15);
  });

  test("a comma-separated list of ALL five statuses equals the union of all five singles", async () => {
    const combined = await titlesFor(`status=${TASK_STATUSES.join(",")}&limit=100`);
    const union: string[] = [];
    for (const status of TASK_STATUSES) union.push(...await titlesFor(`status=${status}&limit=100`));

    expect(combined).toEqual(union.sort());
    expect(combined).toHaveLength(15);
  });

  test("every adjacent pair equals its two singles, so no single element is dropped", async () => {
    for (const [a] of FIXTURE) {
      for (const [b] of FIXTURE) {
        if (a === b) continue;
        const combined = await titlesFor(`status=${a},${b}&limit=100`);
        const union = [...await titlesFor(`status=${a}&limit=100`), ...await titlesFor(`status=${b}&limit=100`)].sort();
        expect(combined).toEqual(union);
      }
    }
  });

  test("surrounding whitespace in the list is tolerated, not treated as a new status", async () => {
    expect(await titlesFor("status= pending , in_progress ")).toEqual(await titlesFor("status=pending,in_progress"));
  });

  test("an out-of-vocabulary element fails the whole list with 400 rather than an empty 200", async () => {
    // The empty-200 is the shape that made the original defect invisible: a caller
    // cannot tell "no matching work" from "the filter never matched anything".
    const response = await request("/v1/tasks?status=pending,totally_bogus_status");
    expect(response?.status).toBe(400);
    const body = await response!.json() as { error?: string };
    expect(body.error).toContain("totally_bogus_status");
  });

  test("`total` tracks the multi-status filter, so a paginating caller sees the right population", async () => {
    const response = await request("/v1/tasks?status=completed,failed,cancelled&limit=2");
    expect(response?.status).toBe(200);
    const page = await response!.json() as TaskPage;
    expect(page.tasks).toHaveLength(2);
    expect(page.count).toBe(2);
    // 3 completed + 4 failed + 5 cancelled. A `total` computed without the status
    // filter would read 15 and silently overstate the population by 3x.
    expect(page.total).toBe(12);
  });
});
