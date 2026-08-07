/**
 * `GET /v1/tasks?updated_after=<ISO>` — a since-cursor for pollers.
 *
 * Measured 2026-08-07 against the deployed API (todos.hasna.xyz, Todos V1 API
 * 0.13.12), holding the read form constant and varying only the cursor:
 *
 *      bytes   rows   total   st  case
 *     420696    200   59547  200  CONTROL baseline
 *       2226      1   59547  200  CONTROL probe-can-move: limit=1
 *     441623    200   29837  200  CONTROL real filter works: status=completed
 *     420696    200   59547  200  CONTROL silently-ignored sig: BOGUSPARAM=xyz
 *     420696    200   59547  200  updated_after = FUTURE   <- after EVERY row
 *
 * `status=completed` moved `total` 59,547 -> 29,837 in the same run, so the
 * server does apply the params it knows; the cursor names specifically were
 * inert. A cursor after every row must return zero rows, not the whole table.
 *
 * These tests assert the OUTCOME (fewer rows come back) and never that the
 * parameter was merely accepted — "the call succeeded" is exactly what the
 * defect already does.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import { handleV1Request, type V1RequestDependencies } from "./v1.js";

let db: Database;
let store: TodosStorageAdapter;
let dependencies: V1RequestDependencies;

function request(path: string): Promise<Response | null> {
  const url = new URL(`https://todos.example.test${path}`);
  return handleV1Request(new Request(url, { method: "GET" }), url, dependencies);
}

async function listTasks(query: string): Promise<{ tasks: Array<{ id: string; updated_at: string }>; total: number }> {
  const response = await request(`/v1/tasks${query}`);
  if (response?.status !== 200) throw new Error(`list failed: ${response?.status}`);
  return await response.json() as { tasks: Array<{ id: string; updated_at: string }>; total: number };
}

/** Stamp updated_at directly so the fixture has a known, ordered spread. */
function stampUpdatedAt(id: string, iso: string): void {
  db.query("UPDATE tasks SET updated_at = ? WHERE id = ?").run(iso, id);
}

const OLD = "2026-01-01T00:00:00.000Z";
const MID = "2026-06-15T12:00:00.000Z";
const NEW = "2026-08-01T09:30:00.000Z";
/** After every row in the fixture. A working cursor returns nothing. */
const FUTURE = "2027-01-01T00:00:00.000Z";
/** Before every row in the fixture. A working cursor returns everything. */
const ANCIENT = "2020-01-01T00:00:00.000Z";

beforeEach(async () => {
  resetDatabase();
  db = getDatabase(":memory:");
  store = createLocalSqliteTodosStorageAdapter({ db });
  dependencies = {
    ensureSchema: async () => {},
    getStorageAdapter: () => store,
    getVerifier: () => ({
      authenticate: async () => ({ ok: true, principal: { agent: null, scopes: ["todos:*"] } }),
    }) as ReturnType<NonNullable<V1RequestDependencies["getVerifier"]>>,
  };
  const a = await store.tasks.create({ title: "old task" });
  const b = await store.tasks.create({ title: "mid task" });
  const c = await store.tasks.create({ title: "new task" });
  stampUpdatedAt(a.id, OLD);
  stampUpdatedAt(b.id, MID);
  stampUpdatedAt(c.id, NEW);
});

afterEach(() => resetDatabase());

describe("GET /v1/tasks?updated_after", () => {
  test("CONTROL: the probe can move the number at all", async () => {
    const all = await listTasks("");
    const one = await listTasks("?limit=1");
    expect(all.tasks.length).toBe(3);
    expect(one.tasks.length).toBe(1);
    // Without this, a cursor test that returns 3 proves nothing about the cursor.
    expect(one.tasks.length).not.toBe(all.tasks.length);
  });

  test("CONTROL: an unknown parameter changes nothing (the ignored-param signature)", async () => {
    const baseline = await listTasks("");
    const bogus = await listTasks("?BOGUSPARAM=xyz");
    expect(bogus.tasks.length).toBe(baseline.tasks.length);
    expect(bogus.total).toBe(baseline.total);
  });

  test("a cursor AFTER every row returns zero rows — the decisive case", async () => {
    const { tasks, total } = await listTasks(`?updated_after=${FUTURE}`);
    expect(tasks.length).toBe(0);
    // `total` must respect the cursor too, or a client paginating on it
    // re-downloads the whole table believing there is more to fetch.
    expect(total).toBe(0);
  });

  test("a MID-RANGE cursor returns strictly fewer rows than no cursor", async () => {
    const baseline = await listTasks("");
    const cursored = await listTasks(`?updated_after=${MID}`);
    expect(baseline.tasks.length).toBe(3);
    // MID is exclusive: only the NEW row is strictly after it.
    expect(cursored.tasks.length).toBe(1);
    expect(cursored.tasks.length).toBeLessThan(baseline.tasks.length);
    expect(cursored.total).toBe(1);
    expect(cursored.tasks[0]!.updated_at).toBe(NEW);
  });

  test("a cursor BEFORE every row returns everything — it must not over-filter", async () => {
    const baseline = await listTasks("");
    const cursored = await listTasks(`?updated_after=${ANCIENT}`);
    expect(cursored.tasks.length).toBe(baseline.tasks.length);
    expect(cursored.total).toBe(baseline.total);
  });

  test("composes with an existing filter rather than replacing it", async () => {
    const both = await listTasks(`?updated_after=${OLD}&limit=1`);
    expect(both.tasks.length).toBe(1);
    // 2 rows are strictly after OLD (MID and NEW); limit trims the page, total does not.
    expect(both.total).toBe(2);
  });

  test("a malformed cursor is rejected loudly, not silently ignored", async () => {
    const response = await request("/v1/tasks?updated_after=not-a-timestamp");
    expect(response?.status).toBe(400);
    const body = await response!.json() as { error?: string };
    expect(String(body.error ?? "")).toContain("updated_after");
  });

  test("tolerates the space-separated timestamps already stored in production", async () => {
    // Measured on todos.hasna.xyz 2026-08-07: some rows carry
    // "2026-06-10 11:24:47" rather than ISO-8601 with a Z. A cursor that
    // string-compares would mis-sort these against "2026-06-10T...".
    const legacy = await store.tasks.create({ title: "legacy stamp" });
    stampUpdatedAt(legacy.id, "2026-07-01 08:00:00");
    const cursored = await listTasks(`?updated_after=2026-06-20T00:00:00.000Z`);
    const ids = cursored.tasks.map((t) => t.id);
    expect(ids).toContain(legacy.id);
  });
});
