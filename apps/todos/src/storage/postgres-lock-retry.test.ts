import { describe, expect, test } from "bun:test";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import type { TodosPostgresQueryClient } from "./postgres-sync.js";

/**
 * Regression tests for incident 724667 / HP-00083 (2026-08-22): the hosted
 * todos authority returned HTTP 500 on PATCH /tasks/{id} (and other /v1
 * paths) in bursts, each failure surfacing
 * `PostgresError: canceling statement due to lock timeout` (SQLSTATE 55P03).
 *
 * Measured on todos.hasna.xyz (CloudWatch, /ecs/todos-prod): 83 failures at
 * 17:50-17:59Z and 83+ at 19:30-19:32Z, all of the same class. The
 * `todos_app` Postgres role carries a 5s `lock_timeout`, so a task write
 * that waits on the task-parent-integrity advisory lock (or a task/plan row
 * lock) past that bound is canceled by the server and the /v1 route mapped
 * the unhandled error to HTTP 500 — indistinguishable from a crash even
 * though the condition is transient (the fleet observed recovery within
 * seconds).
 *
 * The fix retries the whole guarded write transaction (advisory lock +
 * CAS statement) on transient Postgres errors (55P03 / 40P01 / 40001) with
 * a bounded backoff. Each attempt re-acquires the advisory lock and re-runs
 * the version CAS, so the optimistic-concurrency contract is preserved.
 */

interface StubOptions {
  /** How many advisory-lock statements throw a transient 55P03 before succeeding. */
  transientAdvisoryFailures?: number;
  /** Throw a non-transient error instead of 55P03 on advisory-lock statements. */
  nonTransientAdvisoryError?: boolean;
  /** Attach the SQLSTATE on `cause` (Bun-shaped PostgresError) instead of `errno`. */
  sqlStateOnCause?: boolean;
  /** Persistently fail every advisory-lock statement with 55P03. */
  persistentAdvisoryFailure?: boolean;
  /** Bump the stored task version after the first advisory-lock failure. */
  bumpVersionAfterFailure?: boolean;
}

function transient55P03(sqlStateOnCause: boolean): Error {
  const message = "canceling statement due to lock timeout";
  if (sqlStateOnCause) {
    const cause = Object.assign(new Error(message), { code: "55P03" });
    const error = Object.assign(new Error("PostgresError: " + message), {
      code: "ERR_POSTGRES_SERVER_ERROR",
      cause,
    });
    return error;
  }
  const error = Object.assign(new Error(message), { errno: "55P03" });
  return error;
}

function createStubClient(options: StubOptions = {}): TodosPostgresQueryClient & {
  advisoryLockCalls: number;
  guardedWriteCalls: number;
  setStoredVersion: (version: number) => void;
} {
  let advisoryLockCalls = 0;
  let guardedWriteCalls = 0;
  let storedVersion = 1;

  const client: TodosPostgresQueryClient = {
    async transaction<T>(fn: (transaction: TodosPostgresQueryClient) => Promise<T>): Promise<T> {
      return fn(client);
    },
    async query<T = Record<string, unknown>>(sql: string, values: readonly unknown[] = []) {
      // Idempotent schema DDL — never fails.
      if (sql.includes("CREATE TABLE IF NOT EXISTS") || sql.includes("CREATE INDEX IF NOT EXISTS")) {
        return { rows: [] as T[] };
      }
      // The guarded write statement (task-plan-membership / parent-integrity
      // guard): return a validation row that mirrors the real statement.
      if (sql.includes("todos:task-plan-membership-guard") || sql.includes("todos:task-parent-integrity-guard")) {
        guardedWriteCalls += 1;
        const [, , rawPayload, , , , , , , , , expectedVersion] = values;
        // jsonbParam passes the object through; accept either shape.
        const task = (
          rawPayload && typeof rawPayload === "object"
            ? rawPayload
            : JSON.parse(String(rawPayload))
        ) as Record<string, unknown>;
        // Mirrors the SQL CAS: the stored row's version is compared against
        // $12 (parentGuard.expectedVersion), the caller's expected version.
        const versionMatches = storedVersion === Number(expectedVersion);
        return {
          rows: [{
            task_found: true,
            version_matches: versionMatches,
            parent_found: true,
            parent_acyclic: true,
            membership_changed: false,
            target_plan_found: true,
            project_conflict: false,
            payload: versionMatches ? task : null,
            current_payload: { id: task.id, version: storedVersion },
          }] as T[],
        };
      }
      // The task-parent-integrity advisory lock statement.
      if (sql.includes("pg_advisory_xact_lock")) {
        advisoryLockCalls += 1;
        const failTransiently =
          (options.transientAdvisoryFailures ?? 0) > 0 && advisoryLockCalls <= (options.transientAdvisoryFailures ?? 0);
        if (options.persistentAdvisoryFailure) throw transient55P03(false);
        if (failTransiently) {
          if (options.bumpVersionAfterFailure) storedVersion += 1;
          throw transient55P03(Boolean(options.sqlStateOnCause));
        }
        if (options.nonTransientAdvisoryError) {
          throw new Error("syntax error at or near \"SELECT\"");
        }
        return { rows: [] as T[] };
      }
      // Single-record read (store.get / requireRecord).
      if (sql.includes("object_type = $2") && sql.includes("object_id = $3")) {
        return {
          rows: [{
            payload: {
              id: String(values[2]),
              title: "probe",
              status: "pending",
              version: storedVersion,
              plan_id: null,
              parent_id: null,
              project_id: "proj-1",
              updated_at: "2026-08-22T17:50:00.000Z",
            },
            updated_at: "2026-08-22T17:50:00.000Z",
          }] as T[],
        };
      }
      return { rows: [] as T[] };
    },
  };

  return {
    ...client,
    get advisoryLockCalls() {
      return advisoryLockCalls;
    },
    get guardedWriteCalls() {
      return guardedWriteCalls;
    },
    setStoredVersion(version: number) {
      storedVersion = version;
    },
  };
}

function makeAdapter(stub: ReturnType<typeof createStubClient>) {
  return createPostgresTodosStorageAdapter({ client: stub, service: "lock-retry-test" });
}

describe("postgres adapter guarded-write transient lock retry (incident 724667 / HP-00083)", () => {
  test("a single 55P03 on the advisory lock is retried; the PATCH-path update succeeds", async () => {
    const stub = createStubClient({ transientAdvisoryFailures: 1 });
    const adapter = makeAdapter(stub);

    const updated = await adapter.tasks.update("task-1", { version: 1, title: "new title" });

    expect(updated.title).toBe("new title");
    // Attempt 1 failed at the advisory lock; attempt 2 re-ran the whole
    // transaction (advisory lock + guarded write).
    expect(stub.advisoryLockCalls).toBe(2);
    expect(stub.guardedWriteCalls).toBe(1);
  });

  test("a Bun-shaped error with the SQLSTATE on cause is classified transient", async () => {
    const stub = createStubClient({ transientAdvisoryFailures: 1, sqlStateOnCause: true });
    const adapter = makeAdapter(stub);

    const updated = await adapter.tasks.update("task-1", { version: 1, title: "new title" });

    expect(updated.title).toBe("new title");
    expect(stub.advisoryLockCalls).toBe(2);
  });

  test("a persistent 55P03 surfaces after bounded attempts (no unbounded retry loop)", async () => {
    const stub = createStubClient({ persistentAdvisoryFailure: true });
    const adapter = makeAdapter(stub);

    await expect(adapter.tasks.update("task-1", { version: 1, title: "new title" })).rejects.toThrow(
      "canceling statement due to lock timeout",
    );
    // Exactly two transaction attempts (attempts=2), one advisory-lock
    // statement each.
    expect(stub.advisoryLockCalls).toBe(2);
    expect(stub.guardedWriteCalls).toBe(0);
  });

  test("a non-transient error is NOT retried", async () => {
    const stub = createStubClient({ nonTransientAdvisoryError: true });
    const adapter = makeAdapter(stub);

    await expect(adapter.tasks.update("task-1", { version: 1, title: "new title" })).rejects.toThrow(
      "syntax error",
    );
    expect(stub.advisoryLockCalls).toBe(1);
  });

  test("the version CAS is re-evaluated on the retry — a concurrent bump still yields a version conflict", async () => {
    const stub = createStubClient({ transientAdvisoryFailures: 1, bumpVersionAfterFailure: true });
    const adapter = makeAdapter(stub);

    // The first attempt is canceled at the advisory lock; by the retry a
    // concurrent writer bumped the row to version 2, so the guarded write's
    // CAS rejects the stale expected version. Retrying must NOT bypass the
    // optimistic-concurrency contract.
    await expect(adapter.tasks.update("task-1", { version: 1, title: "new title" })).rejects.toThrow(
      /version conflict/i,
    );
    expect(stub.advisoryLockCalls).toBe(2);
    expect(stub.guardedWriteCalls).toBe(1);
  });
});
