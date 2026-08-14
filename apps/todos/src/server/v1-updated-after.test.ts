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

  // The validator and the comparator must accept the SAME language. They did
  // not: `Date.parse` guarded the door and SQLite `julianday()` did the
  // comparing. `?updated_after=2026` passed validation as a valid year and then
  // matched EVERY row, because SQLite reads a bare number as a raw Julian Day —
  // so a caller bounding a read received the whole table under a 200. That is
  // the exact defect this parameter exists to end, arriving through the front
  // door. Each case below is a value one side accepts and the other misreads.
  test.each([
    ["2026", "a bare year — returned the WHOLE TABLE at 200 before this fix"],
    ["2026-08", "reduced precision — silently returned nothing"],
    ["March 5, 2026", "Date.parse accepts it; julianday does not"],
    ["2026-08-07", "date only, no time"],
    ["2026-08-07T12:00:00", "no offset — the instant is undefined"],
    ["2026-02-30T00:00:00Z", "shape is valid but the date is not on the calendar"],
  ])("rejects %j with 400 rather than guessing (%s)", async (cursor) => {
    const response = await request(`/v1/tasks?updated_after=${encodeURIComponent(cursor)}`);
    expect(response?.status).toBe(400);
    // Specifically NOT a 200 carrying rows: silence and the whole table are the
    // two wrong answers this replaces, and both look like success.
  });

  test("accepts a non-Z offset and normalises it to the same instant", async () => {
    // 2026-06-15T15:00:00+03:00 IS 2026-06-15T12:00:00Z, which is exactly MID.
    // Strictly-after MID leaves only the NEW row, so an offset that is parsed
    // but not converted would return a different count here.
    const offset = await listTasks(`?updated_after=${encodeURIComponent("2026-06-15T15:00:00+03:00")}`);
    const zform = await listTasks(`?updated_after=${MID}`);
    expect(offset.tasks.length).toBe(1);
    expect(offset.total).toBe(zform.total);
    expect(offset.tasks.map((t) => t.id)).toEqual(zform.tasks.map((t) => t.id));
  });

  test("compares a space-separated production stamp as an INSTANT, not as text", async () => {
    // Measured on todos.hasna.xyz 2026-08-07: rows carry "2026-06-10 11:24:47"
    // as well as "2026-08-05T18:54:55.814Z".
    //
    // THIS FIXTURE IS CHOSEN TO DISCRIMINATE, and the previous one was not. Its
    // predecessor asserted only `toContain` against a cursor a week earlier, so
    // it passed with the cursor REMOVED ENTIRELY — with no filter, every row
    // comes back and every `toContain` holds. It also compared a June cursor to
    // a July row, where text order and time order happen to agree, so it could
    // not have caught the bug it was named for.
    //
    // Same-date is what separates them: as text, " " (0x20) sorts BEFORE "T"
    // (0x54), so "2026-07-01 08:00:00" reads as EARLIER than
    // "2026-07-01T00:00:00.000Z" and a string comparison drops it. Measured:
    // TEXT rows=0, JULIANDAY rows=1.
    const legacy = await store.tasks.create({ title: "legacy stamp" });
    stampUpdatedAt(legacy.id, "2026-07-01 08:00:00");

    const cursored = await listTasks("?updated_after=2026-07-01T00:00:00.000Z");
    const ids = cursored.tasks.map((t) => t.id).sort();

    // The legacy row is genuinely after the cursor and must come back...
    expect(ids).toContain(legacy.id);
    // ...and the exact-set assertion is what makes this test able to FAIL:
    // OLD and MID are before the cursor, so a removed or text-based comparison
    // changes this number. Only NEW and the legacy row qualify.
    expect(cursored.tasks.length).toBe(2);
    expect(cursored.total).toBe(2);
    // A no-offset stamp is read as UTC, matching the Postgres path — see
    // todos_try_timestamptz in src/storage/postgres-sync.ts. At 08:00 UTC the
    // row is after the cursor; read as local time on a UTC+9 server it would
    // not be, which is the cross-backend disagreement that pinning removes.
    const beforeInUtc = await listTasks("?updated_after=2026-07-01T09:00:00.000Z");
    expect(beforeInUtc.tasks.map((t) => t.id)).not.toContain(legacy.id);
  });
});
