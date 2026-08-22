/**
 * Regression: `ensureCloudSchema` must retry after a transient DDL failure
 * instead of memoizing the rejection forever.
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
 * This test discriminates the poisoned memo from the fixed retry without a
 * database: with an unreachable DSN every attempt fails fast, and a memoized
 * rejection returns the SAME error object forever, while a cleared memo makes
 * each call a fresh attempt (a distinct error object).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { closeCloud, ensureCloudSchema } from "./cloud.js";

const DATABASE_URL_ENV_VARS = [
  "HASNA_TODOS_DATABASE_URL",
  "TODOS_DATABASE_URL",
  "DATABASE_URL",
] as const;

function clearDbEnv(): void {
  for (const name of DATABASE_URL_ENV_VARS) delete process.env[name];
}

describe("ensureCloudSchema transient-failure retry", () => {
  test("a rejected schema run is not memoized — the next call makes a fresh attempt", async () => {
    clearDbEnv();
    // Unreachable-but-well-formed DSN: every attempt fails fast (connection
    // refused) with a NEW error object when the memo is cleared.
    process.env.HASNA_TODOS_DATABASE_URL =
      "postgres://todos_test:unused@127.0.0.1:1/todos?sslmode=disable";
    await closeCloud();

    await expect(ensureCloudSchema()).rejects.toThrow();
    const first = await ensureCloudSchema().catch((e: unknown) => e);
    const second = await ensureCloudSchema().catch((e: unknown) => e);

    // Poisoned memo: first === second (the cached rejection is rethrown).
    // Fixed: each call re-runs the DDL, so each produces its own error.
    expect(second).not.toBe(first);
  });

  afterEach(async () => {
    clearDbEnv();
    await closeCloud();
  });
});
