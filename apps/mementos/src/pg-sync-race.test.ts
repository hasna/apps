/**
 * Regression test for the PgSyncPool stale-response race (todos
 * 027d17e9-d303-4e81-ba15-290eb2539623).
 *
 * PgSyncPool communicates with its worker over one shared status word and one
 * shared data buffer with no request/response correlation. When a query times
 * out, the caller throws without cancelling the in-flight query; the worker
 * later writes the abandoned query's payload into the buffer and flips the
 * status word, so the NEXT query's Atomics.wait is woken by the stale response
 * and parses it as its own result.
 *
 * The stub worker (`test-support/pg-sync-stub-worker.ts`) answers every message
 * with a payload echoing that message's own SQL. Query A is told to respond
 * slower than the (env-shortened) query timeout; the caller times out, then
 * posts query B; A's late response lands while B is waiting and MUST be
 * discarded — B returns its own echoed payload, never A's.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Shrink the per-query timeout so the race plays out in milliseconds. The
// timeout is read per query() call, so this takes effect without import-order
// games; the dynamic import below is belt-and-braces.
process.env["MEMENTOS_PGSYNC_QUERY_TIMEOUT_MS"] = "500";

const { PgSyncPool } = await import("./storage.js");

const here = fileURLToPath(new URL(".", import.meta.url));
const stubWorkerPath = join(here, "test-support", "pg-sync-stub-worker.ts");

describe("PgSyncPool stale-response race", () => {
  test("a timed-out query's late response is never consumed by a newer query", () => {
    const pool = new PgSyncPool("postgres://stub/never-connects", stubWorkerPath);
    try {
      // A sleeps 700ms on the worker; the caller gives up at 500ms and throws.
      expect(() => pool.query("SLEEP_700 SELECT 1 AS marker_a", [])).toThrow(
        /PostgreSQL query timed out/
      );

      // B is posted right after A's timeout. A's response lands ~200ms later,
      // while B is still waiting: the buggy protocol consumes it (B receives
      // A's echoed SQL), the fixed protocol discards the stale generation.
      const resultB = pool.query("SLEEP_400 SELECT 7 AS marker_b", []);
      expect(resultB.rows).toEqual([{ echoed: "SLEEP_400 SELECT 7 AS marker_b" }]);
      expect(resultB.rowCount).toBe(1);

      // The shared slot must be usable again after the stale response is dropped.
      const resultC = pool.query("SELECT 9 AS marker_c", []);
      expect(resultC.rows).toEqual([{ echoed: "SELECT 9 AS marker_c" }]);
    } finally {
      pool.end();
    }
  });
});
