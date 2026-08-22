/**
 * Regression: a transient Postgres DDL failure must not permanently poison the
 * process's schema-ensure memo.
 *
 * Measured incident 2026-08-22 (todos row 724397, board 724583): the hosted
 * /v1 API returned HTTP 500 on roughly half of ALL requests — reads and writes
 * alike, content-independent — for hours, reading as an "intermittent outage".
 * The server log carried 4000+ `PostgresError: canceling statement due to lock
 * timeout` (SQLSTATE 55P03) in 8h, and the RDS log pinned the cancelled
 * statement at process start to
 * `CREATE INDEX IF NOT EXISTS todos_sync_records_updated_idx ...` inside the
 * schema-ensure DDL. PostgresJsonRecordStore.ensureSchema memoizes that DDL
 * run with `this.schemaReady ??= ...`, so ONE lock timeout at first use
 * rejects the memoized promise FOREVER: every later store operation on that
 * process failed before reaching its route. With two ECS tasks, one poisoned
 * process produced the ~50% fleet-wide failure rate and the "deterministic"
 * content-dependence reported by the incident lane was a sampling artifact of
 * the flake window (control content failed at the same rate).
 *
 * The fix clears the memo on rejection so the next call retries the
 * idempotent (IF NOT EXISTS / OR REPLACE) schema DDL.
 */
import { describe, expect, test } from "bun:test";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";

describe("PostgresJsonRecordStore schema-ensure transient-failure retry", () => {
  test("a DDL lock timeout on first use is not memoized — the next call retries and succeeds", async () => {
    let queryCalls = 0;
    const client = {
      query: async <T>() => {
        queryCalls += 1;
        if (queryCalls === 1) {
          // Simulate the measured failure: Postgres cancels the DDL statement
          // because lock_timeout expired while CREATE INDEX waited on a lock.
          throw new Error("canceling statement due to lock timeout");
        }
        return { rows: [] as T[] };
      },
    };
    const adapter = createPostgresTodosStorageAdapter({
      client: client as never,
      service: "schema-retry-test",
    });

    // First use: the schema DDL throws -> the read fails.
    await expect(adapter.tasks.get("task-1")).rejects.toThrow("lock timeout");

    // Second use: with a memoized rejection this rejects with the STALE error
    // (poisoned process); the fix re-runs the idempotent DDL and the read
    // resolves normally.
    await expect(adapter.tasks.get("task-1")).resolves.toBeNull();
    expect(queryCalls).toBeGreaterThan(1);
  });
});
