#!/usr/bin/env bun
/**
 * Live PostgreSQL proof gate — `storage.pgTestGate` in hasna.contract.json.
 *
 * Exercises the repo's OWN PostgreSQL code path against a real server:
 * applies the cloud migration set through the vendored storage-kit ledger
 * (the same runner `sessions migrate` uses), then writes and reads a row back
 * through the same kit query client the cloud store uses at runtime.
 *
 * FAIL-CLOSED BY DESIGN. With no DSN set this exits 1 rather than skipping: a
 * proof gate that reports success when it did not run is the vacuous check the
 * contract's storage clause exists to prevent. The DSN variable is TEST-ONLY
 * and deliberately distinct from `HASNA_SESSIONS_DATABASE_URL`, so pointing
 * the gate at a live store takes a separate, explicit act.
 *
 *   SESSIONS_TEST_DATABASE_URL=postgres://... bun run test:pg
 *
 * The probe row is deleted before exit; the connection string is never
 * printed, in full or in part.
 */
import { createQueryClient, createPgPool } from "../src/generated/storage-kit/index.js";
import { runCloudMigrations } from "../src/db/cloud/migrate.js";

const ENV_VAR = "SESSIONS_TEST_DATABASE_URL";

function fail(message: string): never {
  console.error(`[pg-test-gate] FAIL: ${message}`);
  process.exit(1);
}

const connectionString = process.env[ENV_VAR]?.trim();
if (!connectionString) {
  fail(
    `${ENV_VAR} is not set. This gate proves live PostgreSQL support and cannot ` +
      `pass without a PostgreSQL server; point it at a throwaway test database.`
  );
}

const pool = createPgPool({
  connectionString,
  applicationName: "sessions-pg-test-gate",
  max: 2,
});
const client = createQueryClient(pool);
const probeId = crypto.randomUUID();
const probeSource = "claude";
const probeSourceId = `pg-test-gate-${crypto.randomUUID()}`;
let checks = 0;

try {
  // 1. Schema — the repo's own cloud migration set must apply cleanly.
  const report = await runCloudMigrations({ client });
  if (report.applied.length === 0 && report.alreadyApplied.length === 0) {
    fail("no PostgreSQL migrations were found to apply");
  }
  checks++;

  // 2. Write and read back through the cloud store's query client.
  await client.execute(
    `INSERT INTO sessions (id, source, source_id, title)
     VALUES ($1, $2, $3, 'pg-test-gate probe')`,
    [probeId, probeSource, probeSourceId]
  );
  const recalled = await client.get<{ id: string; source: string; source_id: string }>(
    "SELECT id, source, source_id FROM sessions WHERE id = $1",
    [probeId]
  );
  if (!recalled || recalled.id !== probeId || recalled.source !== probeSource || recalled.source_id !== probeSourceId) {
    fail("round-trip read returned no row: the postgres write path did not persist");
  }
  checks++;

  // 3. Delete the probe row.
  await client.execute("DELETE FROM sessions WHERE id = $1", [probeId]);
  const gone = await client.get<{ id: string }>("SELECT id FROM sessions WHERE id = $1", [probeId]);
  if (gone) {
    fail("probe row survived the delete");
  }
  checks++;

  console.log(
    `[pg-test-gate] PASS: ${checks} live PostgreSQL checks (schema, round-trip, delete)`
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await client.execute("DELETE FROM sessions WHERE id = $1", [probeId]).catch(() => {});
  await pool.end().catch(() => {});
}
