#!/usr/bin/env bun
/**
 * Live PostgreSQL proof gate — `storage.pgTestGate` in hasna.contract.json.
 *
 * Exercises the repo's OWN PostgreSQL code path against a real server:
 * applies the secrets schema (SECRETS_MIGRATIONS) through the vendored
 * storage-kit MigrationLedger, then writes a secret and reads it back through
 * CloudSecretsStore — the same store the serve entrypoint uses at runtime.
 *
 * FAIL-CLOSED BY DESIGN. With no DSN set this exits 1 rather than skipping: a
 * proof gate that reports success when it did not run is the vacuous check the
 * contract's storage clause exists to prevent. The DSN variable is TEST-ONLY
 * and deliberately distinct from HASNA_SECRETS_DATABASE_URL, so pointing the
 * gate at a live store takes a separate, explicit act.
 *
 *   SECRETS_TEST_DATABASE_URL=postgres://... bun run test:pg
 *
 * The probe row is deleted before exit; the connection string is never
 * printed, in full or in part.
 */
import { randomUUID } from "node:crypto";
import { createPgPool } from "../src/generated/storage-kit/pool.js";
import { createQueryClient } from "../src/generated/storage-kit/query.js";
import { MigrationLedger } from "../src/generated/storage-kit/migrations.js";
import { SECRETS_MIGRATIONS } from "../src/server/cloud-migrations.js";
import { CloudSecretsStore } from "../src/server/cloud-store.js";

const ENV_VAR = "SECRETS_TEST_DATABASE_URL";

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
const store = new CloudSecretsStore(client);
const probeKey = `pg-gate-${randomUUID().slice(0, 8)}/api_key`;
const probeValue = `probe-${randomUUID().slice(0, 8)}`;

try {
  const ledger = new MigrationLedger(client, SECRETS_MIGRATIONS);
  await ledger.migrate();

  await store.setSecret(probeKey, probeValue, "api_key", "pg-gate-probe", undefined, "pg-test-gate", "pg-test-gate");
  const readBack = await store.getSecret(probeKey, "pg-test-gate", "pg-test-gate");
  if (!readBack) {
    fail("getSecret returned no row after setSecret");
  }
  if (readBack.key !== probeKey) {
    fail("getSecret read back a different key than setSecret wrote");
  }
  await store.deleteSecret(probeKey, "pg-test-gate", "pg-test-gate");
  console.log("[pg-test-gate] ok — migrations + CloudSecretsStore write/read round-trip");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await client.close();
}
