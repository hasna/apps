/**
 * Regression: `ensureCloudSchema` must retry after a transient DDL failure
 * instead of memoizing the rejection forever — and retries must be throttled
 * by a min-interval cooldown.
 *
 * Incident 2026-08-22 (todos row 724397): the hosted /v1 API 500'd on ~half of
 * all requests for hours. The RDS log captured the poisoned process's first
 * request failing at
 * `CREATE INDEX IF NOT EXISTS todos_sync_records_updated_idx ...` with
 * `canceling statement due to lock timeout` (55P03). ensureCloudSchema caches
 * its run in the module-level `schemaEnsured` promise, so that single
 * rejection made EVERY later /v1 request on the process fail — and because
 * v1.ts awaits ensureCloudSchema OUTSIDE the handler try/catch, each failure
 * escaped as Bun's bare `Something went wrong!` 500 with no structured error.
 * Two ECS tasks, one poisoned -> the measured ~50% "intermittent" flake.
 *
 * PR #931 fixed the memo poison (the memo is cleared on rejection, so the next
 * request retries). Its review raised a P2 (todos O15-00479): the retry has
 * NO cooldown, so a SUSTAINED schema failure (DB down, lock contention that
 * outlives a few requests) re-runs the whole idempotent DDL sequence on EVERY
 * request — pool saturation under lock contention. A min-interval cooldown
 * bounds retries: after a failed attempt, calls inside the window rethrow the
 * recorded failure WITHOUT re-running the DDL; the first call after the
 * interval makes a fresh attempt.
 *
 * These tests discriminate the behaviours without a database: with an
 * unreachable DSN every attempt fails fast. Inside the cooldown the SAME error
 * object is rethrown (no fresh DDL run); after the cooldown a fresh attempt
 * produces a distinct error object.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { closeCloud, ensureCloudSchema } from "./cloud.js";

const DATABASE_URL_ENV_VARS = [
  "HASNA_TODOS_DATABASE_URL",
  "TODOS_DATABASE_URL",
  "DATABASE_URL",
] as const;

/** Test knob for the schema-retry min-interval cooldown (ms). */
const RETRY_MIN_ENV = "HASNA_TODOS_SCHEMA_RETRY_MIN_MS";

const UNREACHABLE_DSN =
  "postgres://todos_test:unused@127.0.0.1:1/todos?sslmode=disable";

function clearDbEnv(): void {
  for (const name of DATABASE_URL_ENV_VARS) delete process.env[name];
  delete process.env[RETRY_MIN_ENV];
}

async function captureSchemaFailure(): Promise<unknown> {
  return ensureCloudSchema().catch((e: unknown) => e);
}

describe("ensureCloudSchema transient-failure retry", () => {
  test("retry attempts are throttled by the min-interval cooldown", async () => {
    clearDbEnv();
    process.env.HASNA_TODOS_DATABASE_URL = UNREACHABLE_DSN;
    // A long cooldown: after the first failed attempt, calls inside the window
    // must rethrow the recorded failure WITHOUT re-running the DDL.
    process.env[RETRY_MIN_ENV] = "600000";
    await closeCloud();

    const first = await captureSchemaFailure();
    const second = await captureSchemaFailure();
    const third = await captureSchemaFailure();

    // Same error object identity proves no fresh DDL attempt happened inside
    // the cooldown window (a fresh attempt would fail with a new error).
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  test("a rejected schema run is not memoized forever — a fresh attempt runs after the cooldown", async () => {
    clearDbEnv();
    process.env.HASNA_TODOS_DATABASE_URL = UNREACHABLE_DSN;
    // A 1ms cooldown elapses between attempts; each call is a fresh attempt.
    process.env[RETRY_MIN_ENV] = "1";
    await closeCloud();

    const first = await captureSchemaFailure();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await captureSchemaFailure();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const third = await captureSchemaFailure();

    // Distinct error objects prove the memo was not poisoned forever: after
    // the cooldown each call re-runs the idempotent DDL and fails fresh.
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
  });

  afterEach(async () => {
    clearDbEnv();
    await closeCloud();
  });
});
