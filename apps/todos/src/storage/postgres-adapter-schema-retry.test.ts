import { describe, expect, test } from "bun:test";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import type { TodosPostgresQueryClient } from "./postgres-sync.js";

/**
 * Regression test for incident 724661 (2026-08-22): a failed one-time schema
 * sync permanently bricked the Postgres store's write path.
 *
 * Measured on todos.hasna.xyz: the boot-time schema sync (`CREATE INDEX IF
 * NOT EXISTS todos_sync_records_updated_idx`) hit a 5s `lock_timeout` on the
 * `todos_app` role. `ensureSchema()` cached the rejected `schemaReady`
 * promise forever, so every subsequent task write re-threw the same stale
 * "canceling statement due to lock timeout" error instantly (no DB round
 * trip) and returned HTTP 500 — until the task was replaced.
 */
describe("postgres adapter ensureSchema recovery", () => {
  test("a failed schema sync is retried on the next operation instead of being cached forever", async () => {
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

    // The first operation surfaces the schema-sync failure.
    await expect(adapter.tasks.get("task-1")).rejects.toThrow(
      "canceling statement due to lock timeout",
    );

    // The failure must NOT be cached: the next operation re-runs the schema
    // sync (which now succeeds) and completes normally.
    await expect(adapter.tasks.get("task-1")).resolves.toBeNull();
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
