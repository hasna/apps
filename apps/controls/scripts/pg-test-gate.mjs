#!/usr/bin/env bun
/**
 * Live PostgreSQL proof gate — `storage.pgTestGate` in hasna.contract.json.
 *
 * Exercises the controls app's OWN PostgreSQL code path against a real server:
 * `provisionCloudStore()` in src/db/database.ts — the same DSN resolution
 * (`resolveDatabaseUrl()`), TLS-policy enforcement (sslmode=verify-full via the
 * vendored storage-kit tls.ts), and vendored storage-kit pool used by the
 * PostgreSQL backend — then a write/read round-trip through the kit's typed
 * query wrapper.
 *
 * FAIL-CLOSED BY DESIGN. With no DSN set this exits 2 rather than skipping: a
 * proof gate that reports success when it did not run is the vacuous check the
 * contract's storage clause exists to prevent. The DSN variable is TEST-ONLY
 * and deliberately distinct from `HASNA_CONTROLS_DATABASE_URL`, so pointing the
 * gate at a live store takes a separate, explicit act.
 *
 *   Point CONTROLS_TEST_DATABASE_URL at a throwaway test database whose DSN
 *   carries sslmode=verify-full (e.g. a postgres:// URL with that parameter),
 *   then run: PGSSLROOTCERT=/path/to/test-ca.pem bun run test:postgres
 *
 * The connection string is never printed, in full or in part. Probe rows are
 * dropped by the gate itself.
 */
import { provisionCloudStore } from "../src/db/database.js";

const ENV_VAR = "CONTROLS_TEST_DATABASE_URL";

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

// The app's cloud path reads HASNA_CONTROLS_DATABASE_URL; the gate supplies it
// from the test-only variable, then scrubs it after connecting.
process.env["HASNA_CONTROLS_DATABASE_URL"] = connectionString;

let client;
try {
  client = await provisionCloudStore();
  const probe = await client.one("SELECT 1 AS ok");
  if (probe.ok !== 1) fail("SELECT 1 roundtrip returned an unexpected shape");

  await client.transaction(async (tx) => {
    await tx.execute("CREATE TABLE controls_pg_gate_probe (id serial PRIMARY KEY, payload text NOT NULL)");
    try {
      await tx.execute("INSERT INTO controls_pg_gate_probe (payload) VALUES ($1)", ["probe"]);
      const row = await tx.get("SELECT payload FROM controls_pg_gate_probe ORDER BY id DESC LIMIT 1");
      if (row?.payload !== "probe") fail("write/read roundtrip returned a mismatched payload");
    } finally {
      await tx.execute("DROP TABLE controls_pg_gate_probe");
    }
  });

  console.log("[pg-test-gate] PASS: PostgreSQL connection + write/read roundtrip through the app's cloud path.");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  if (client) {
    try {
      await client.close();
    } catch {
      // close failure is not the gate's signal; the roundtrip already decided
    }
  }
  delete process.env["HASNA_CONTROLS_DATABASE_URL"];
  delete process.env[ENV_VAR];
}
