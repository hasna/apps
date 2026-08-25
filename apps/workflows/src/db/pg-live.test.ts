/**
 * Harness for the live-PostgreSQL gate declared in hasna.contract.json
 * (storage.pgTestGate).
 *
 * This is the only test in slice 1 that opens a real Postgres connection.
 * It proves the declared `postgresql` storage engine is reachable; the
 * store slice adds the store-level pg tests.
 *
 * The gate must not be able to pass without a database:
 *   - URL set                                   -> connect for real; an
 *     unreachable database fails the suite.
 *   - URL unset, WORKFLOWS_REQUIRE_POSTGRES=1   -> throw. The declared gate
 *     command exports that flag, so a vacuous green run is impossible.
 *   - URL unset, flag unset                     -> skip loudly, so `bun run
 *     test` stays green on a machine with no Postgres.
 */
import { describe, expect, test } from "bun:test";
import pg from "pg";

const url = process.env.WORKFLOWS_TEST_DATABASE_URL;
const requirePg = process.env.WORKFLOWS_REQUIRE_POSTGRES === "1";

describe("workflows postgres connectivity gate", () => {
  test("connects to the declared postgres backend and runs SELECT 1", async () => {
    if (!url) {
      if (requirePg) {
        throw new Error("WORKFLOWS_TEST_DATABASE_URL must point at a throwaway Postgres; the live-PG gate must not pass without one");
      }
      console.warn("[workflows] WORKFLOWS_TEST_DATABASE_URL unset — live-PG gate skipped; the declared gate (bun run test:pg) fails closed without it");
      return;
    }
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const res = await client.query("SELECT 1 AS one");
      expect(res.rows[0].one).toBe(1);
    } finally {
      await client.end();
    }
  }, 30_000);
});
