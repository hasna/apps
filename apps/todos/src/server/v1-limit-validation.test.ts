/**
 * `GET /v1/tasks?limit=<n>&offset=<n>` — pagination bound validation.
 *
 * The route used to map `limit: Number(url.searchParams.get("limit"))` straight
 * into the store filter. `listTasks` only adds a LIMIT clause when the value is
 * truthy, so the bound silently disappeared for the values this suite names:
 *
 *      st  rows  case
 *      200   3   ?limit=0     <- 0 is falsy: no LIMIT clause, whole table
 *      200   3   ?limit=-1    <- SQLite `LIMIT -1` means "no limit"
 *      200   3   ?limit=abc   <- Number("abc") is NaN, and NaN is falsy
 *      200   2   ?limit=2     <- CONTROL: the parameter CAN move the number
 *
 * Every one of those answers 200 with the ENTIRE table while the caller
 * believes the read was bounded — the exact failure the `updated_after`
 * rejection in v1.ts exists to end. On the Postgres backend the same values
 * instead reach `LIMIT $n` and error, so the endpoint also 500'd
 * cross-backend. The OpenAPI contract for this endpoint already says `limit`
 * is an integer >= 1 and `offset` an integer >= 0; these tests assert the
 * endpoint enforces it (400, fail closed), and never that the parameter was
 * merely accepted — "the call succeeded" is exactly what the defect already
 * did.
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

async function listTasks(query: string): Promise<{ tasks: Array<{ id: string }>; total: number }> {
  const response = await request(`/v1/tasks${query}`);
  if (response?.status !== 200) throw new Error(`list failed: ${response?.status}`);
  return await response.json() as { tasks: Array<{ id: string }>; total: number };
}

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
  await store.tasks.create({ title: "task a" });
  await store.tasks.create({ title: "task b" });
  await store.tasks.create({ title: "task c" });
});

afterEach(() => resetDatabase());

describe("GET /v1/tasks?limit", () => {
  test("CONTROL: the probe can move the number at all", async () => {
    const all = await listTasks("");
    const two = await listTasks("?limit=2");
    expect(all.tasks.length).toBe(3);
    expect(two.tasks.length).toBe(2);
    // Without this, a limit test that returns 3 proves nothing about the limit.
    expect(two.tasks.length).not.toBe(all.tasks.length);
  });

  test("CONTROL: total ignores limit and reports the full match count", async () => {
    const two = await listTasks("?limit=2");
    expect(two.tasks.length).toBe(2);
    expect(two.total).toBe(3);
  });

  test("CONTROL: a valid offset moves the window and composes with limit", async () => {
    const first = await listTasks("?limit=1&offset=0");
    const second = await listTasks("?limit=1&offset=1");
    expect(first.tasks.length).toBe(1);
    expect(second.tasks.length).toBe(1);
    expect(second.tasks[0]!.id).not.toBe(first.tasks[0]!.id);
  });

  // Each of these answered 200 with the WHOLE TABLE before the fix — the
  // "the call succeeded" wrong answer, which is why the assertion is the
  // status code and never the row count.
  test.each([
    ["0", "zero is falsy in the store, so the LIMIT clause vanished"],
    ["-1", "SQLite LIMIT -1 means no limit"],
    ["abc", "Number(\"abc\") is NaN, and NaN is falsy"],
    ["", "an empty value parsed to Number(\"\") === 0"],
    ["1.5", "not an integer — must not silently truncate"],
    ["1e3", "not an integer spelling"],
    ["99999999999999999999999999", "Number() overflows the safe-integer range"],
  ])("rejects limit=%j with 400 rather than returning the whole table (%s)", async (value) => {
    const response = await request(`/v1/tasks?limit=${encodeURIComponent(value)}`);
    expect(response?.status).toBe(400);
    // Specifically NOT a 200 carrying rows: silence and the whole table are the
    // two wrong answers this replaces, and both look like success.
    const body = await response!.json() as { error?: string };
    expect(String(body.error ?? "")).toContain("limit");
  });

  test.each([
    ["-1", "a negative offset must not be cast into the store"],
    ["abc", "non-numeric offset must not parse to NaN"],
    ["", "an empty offset must not parse to 0"],
  ])("rejects offset=%j with 400 rather than guessing (%s)", async (value) => {
    const response = await request(`/v1/tasks?limit=2&offset=${encodeURIComponent(value)}`);
    expect(response?.status).toBe(400);
    const body = await response!.json() as { error?: string };
    expect(String(body.error ?? "")).toContain("offset");
  });

  test("accepts the maximum requested bound without truncating it", async () => {
    // A caller may legitimately ask for every row (the CLI does, with
    // --limit 50000); the endpoint must honour a valid large integer rather
    // than cap it at an undocumented lower bound.
    const all = await listTasks("?limit=3");
    expect(all.tasks.length).toBe(3);
    expect(all.total).toBe(3);
  });
});
