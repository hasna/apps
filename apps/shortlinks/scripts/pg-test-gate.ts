#!/usr/bin/env bun
/**
 * Live PostgreSQL proof gate — `storage.pgTestGate` in hasna.contract.json.
 *
 * Exercises the repo's OWN PostgreSQL code path against a real server:
 * applies the shortlinks PG schema (SHORTLINKS_MIGRATIONS) through the
 * vendored storage-kit MigrationLedger, then writes a domain + link and reads
 * it back through PgShortlinksStore — the same store the serve entrypoint
 * uses at runtime.
 *
 * FAIL-CLOSED BY DESIGN. With no DSN set this exits 1 rather than skipping: a
 * proof gate that reports success when it did not run is the vacuous check the
 * contract's storage clause exists to prevent. The DSN variable is TEST-ONLY
 * and deliberately distinct from HASNA_SHORTLINKS_DATABASE_URL, so pointing
 * the gate at a live store takes a separate, explicit act.
 *
 *   SHORTLINKS_TEST_DATABASE_URL=postgres://... bun run test:pg
 *
 * The probe rows are deleted before exit; the connection string is never
 * printed, in full or in part.
 */
import { createPgPool } from "../src/generated/storage-kit/pool.js";
import { createQueryClient } from "../src/generated/storage-kit/query.js";
import { MigrationLedger } from "../src/generated/storage-kit/migrations.js";
import { SHORTLINKS_MIGRATIONS } from "../src/db/migrations.js";
import { PgShortlinksStore } from "../src/pg-store.js";

const ENV_VAR = "SHORTLINKS_TEST_DATABASE_URL";

function fail(message: string): never {
  console.error(`[pg-test-gate] FAIL: ${message}`);
  process.exit(1);
}

const connectionString = process.env[ENV_VAR]?.trim();
if (!connectionString) {
  fail(
    `${ENV_VAR} is not set. This gate proves live PostgreSQL support and cannot ` +
      `pass without a PostgreSQL server; point it at a throwaway test database.`,
  );
}

const pool = createPgPool({ connectionString });
const client = createQueryClient(pool);
const store = PgShortlinksStore.fromQueryClient(client);
const probeHostname = `pg-gate-${crypto.randomUUID().slice(0, 8)}.hasna.test`;
const probeSlug = `pg-gate-${crypto.randomUUID().slice(0, 8)}`;

try {
  const ledger = new MigrationLedger(client, SHORTLINKS_MIGRATIONS);
  await ledger.migrate();

  const domain = await store.addDomain({ hostname: probeHostname });
  const link = await store.createLink({
    destinationUrl: "https://example.com/pg-gate-probe",
    domain: probeHostname,
    slug: probeSlug,
    title: "pg-gate-probe",
  });
  const readBack = await store.getLink(probeHostname, probeSlug);
  if (!readBack || readBack.slug !== link.slug) {
    fail("createLink row did not read back through PgShortlinksStore");
  }
  const stats = await store.totalStats();
  if (stats.domains < 1) {
    fail("totalStats did not observe the probe domain");
  }
  await store.deleteLink(probeHostname, probeSlug);
  await store.deleteDomain(probeHostname);
  console.log("[pg-test-gate] ok — migrations + PgShortlinksStore write/read round-trip");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await client.close();
}
