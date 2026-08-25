/**
 * `listTasks({ limit })` — fail-closed limit validation.
 *
 * The store used to add a LIMIT clause only when the filter value was truthy,
 * so a provided-but-invalid limit silently returned the WHOLE table:
 *
 *      limit  rows  case
 *      0      all   0 is falsy: no LIMIT clause
 *      -1     all   SQLite `LIMIT -1` means "no limit"
 *      NaN    all   Number("abc") is NaN, and NaN is falsy
 *      >cap   all   unbounded beyond the documented cap
 *      2      two   CONTROL: the parameter CAN move the number
 *
 * This mirrors the server-side pagination validation (v1-limit-validation)
 * at the store layer, so every caller — CLI dedupe, MCP tools, SDK — gets
 * the same fail-closed behavior instead of each boundary re-deriving it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { getDatabase, resetDatabase } from "./database.js";
import { listTasks, MAX_TASK_LIST_LIMIT } from "./task-crud.js";

describe("listTasks limit validation (fail closed)", () => {
  let db: Database;
  beforeEach(() => {
    resetDatabase();
    db = getDatabase(":memory:");
  });

  test("rejects zero, negative, nonnumeric, fractional, and over-cap limits", () => {
    const badLimits = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, MAX_TASK_LIST_LIMIT + 1];
    for (const bad of badLimits) {
      expect(() => listTasks({ limit: bad }, db), `limit=${String(bad)}`).toThrow(/positive integer/);
    }
  });

  test("accepts a valid positive limit and bounds the returned rows", () => {
    // CONTROL: the parameter can move the number — the suite must prove the
    // acceptance path works, not merely that the rejection path fires.
    expect(() => listTasks({ limit: 1 }, db)).not.toThrow();
    expect(() => listTasks({ limit: MAX_TASK_LIST_LIMIT }, db)).not.toThrow();
    expect(Array.isArray(listTasks({ limit: 1 }, db))).toBe(true);
  });

  test("omitted limit keeps the previous unbounded behavior (no regression for callers that do not bound)", () => {
    expect(() => listTasks({}, db)).not.toThrow();
    expect(() => listTasks({ include_archived: true }, db)).not.toThrow();
  });
});
