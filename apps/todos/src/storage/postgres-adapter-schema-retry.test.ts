import { describe, expect, test } from "bun:test";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import type { TodosPostgresQueryClient } from "./postgres-sync.js";

/**
 * Regression tests for incident 724661 (2026-08-22) and the 2026-08-22
 * lock-timeout bursts behind incident 724667 / HP-00083: schema sync and
 * write-path statements that hit the `todos_app` role's 5s `lock_timeout`
 * (SQLSTATE 55P03) must be retried transiently, and a persistently failing
 * schema sync must never be cached as a permanently-rejected promise.
 *
 * Measured on todos.hasna.xyz: the boot-time schema sync (`CREATE INDEX IF
 * NOT EXISTS todos_sync_records_updated_idx`) hit a 5s `lock_timeout` on the
 * `todos_app` role. `ensureSchema()` cached the rejected `schemaReady`
 * promise forever, so every subsequent task write re-threw the same stale
 * "canceling statement due to lock timeout" error instantly (no DB round
 * trip) and returned HTTP 500 — until the task was replaced.
 */
describe("postgres adapter ensureSchema recovery", () => {
  test("a single transient lock timeout on schema sync is retried in-request; the operation succeeds", async () => {
    let queryCalls = 0;
    const client: TodosPostgresQueryClient = {
      async query() {
        queryCalls += 1;
        if (queryCalls === 1) {
          const error = new Error("canceling statement due to lock timeout") as Error & {
            errno?: string;
          };
          error.errno = "55P03";
          throw error;
        }
        return { rows: [] };
      },
    };
    const adapter = createPostgresTodosStorageAdapter({ client });

    // The transient 55P03 is retried within the same operation (incident
    // 724667 / HP-00083 class): the client sees success, not HTTP 500.
    await expect(adapter.tasks.get("task-1")).resolves.toBeNull();
    expect(queryCalls).toBeGreaterThan(1);
  });

  test("a persistently failing schema sync is not cached forever; the next operation retries it", async () => {
    let schemaQueries = 0;
    let fail = true;
    const client: TodosPostgresQueryClient = {
      async query() {
        schemaQueries += 1;
        if (fail) {
          const error = new Error("canceling statement due to lock timeout") as Error & {
            errno?: string;
          };
          error.errno = "55P03";
          throw error;
        }
        return { rows: [] };
      },
    };
    const adapter = createPostgresTodosStorageAdapter({ client });

    // Every in-request retry also fails (the lock holder persists) — the
    // operation surfaces the transient error after bounded attempts.
    await expect(adapter.tasks.get("task-1")).rejects.toThrow(
      "canceling statement due to lock timeout",
    );

    // The failure must NOT be cached: once the holder commits, the next
    // operation re-runs the schema sync and completes normally.
    fail = false;
    await expect(adapter.tasks.get("task-1")).resolves.toBeNull();
    expect(schemaQueries).toBeGreaterThan(2);
  });

  test("a successful schema sync stays cached across operations", async () => {
    let schemaCalls = 0;
    const client: TodosPostgresQueryClient = {
      async query(sql: string) {
        if (sql.includes("CREATE TABLE IF NOT EXISTS")) schemaCalls += 1;
        return { rows: [] };
      },
    };
    const adapter = createPostgresTodosStorageAdapter({ client });

    await expect(adapter.tasks.get("task-1")).resolves.toBeNull();
    await expect(adapter.tasks.get("task-2")).resolves.toBeNull();

    // The schema sync runs exactly once (two CREATE TABLE statements);
    // subsequent operations reuse the resolved promise instead of re-issuing
    // the schema statements.
    expect(schemaCalls).toBe(2);
  });
});
