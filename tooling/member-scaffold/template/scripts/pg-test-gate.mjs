#!/usr/bin/env bun
/**
 * Live PostgreSQL proof gate — `storage.pgTestGate` in hasna.contract.json.
 *
 * The scaffold declares both storage engines (the contract kit refuses a
 * waiver for a service-capable member shipping __MEMBER__-serve, measured
 * 2026-08-19), so it carries a proof gate. FAIL-CLOSED BY DESIGN: with no
 * DSN set this exits 2 rather than skipping — a proof gate that reports
 * success when it did not run is the vacuous check the contract's storage
 * clause exists to prevent.
 *
 * The generated member has no PostgreSQL code path yet; this gate proves the
 * CONNECTION (Bun.sql SELECT 1) against a real server. When the member
 * implements its own PostgreSQL backend, extend this gate to exercise that
 * code path the way a live member's pg-test-gate does (e.g.
 * apps/mementos/scripts/pg-test-gate.ts).
 *
 *   Point __MEMBER_UPPER___TEST_DATABASE_URL at a throwaway test database:
 *   bun run test:postgres
 *
 * The connection string is never printed.
 */
const ENV_VAR = "__MEMBER_UPPER___TEST_DATABASE_URL";

function fail(message) {
  console.error(`[pg-test-gate] FAIL: ${message}`);
  process.exit(1);
}

const connectionString = process.env[ENV_VAR]?.trim();
if (!connectionString) {
  console.error(
    `[pg-test-gate] FAIL: ${ENV_VAR} is not set. This gate proves live PostgreSQL support and cannot ` +
      `pass without a PostgreSQL server; point it at a throwaway test database.`,
  );
  process.exit(2);
}

try {
  const sql = new Bun.SQL(connectionString);
  const row = await sql`SELECT 1 AS ok`.first();
  if (row?.ok !== 1) fail("SELECT 1 roundtrip returned an unexpected shape");
  sql.close();
  console.log("[pg-test-gate] PASS: PostgreSQL connection roundtrip (Bun.sql).");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
