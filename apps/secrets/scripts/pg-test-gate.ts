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
 * The isolated fixture schema and role are removed before exit; the connection string is never
 * printed, in full or in part.
 */
import { randomUUID, randomBytes } from "node:crypto";
import { ApiKeyStore, mintApiKey } from "@hasna/contracts/auth";
import { createPgPool } from "../src/generated/storage-kit/pool.js";
import { createQueryClient } from "../src/generated/storage-kit/query.js";
import { MigrationLedger } from "../src/generated/storage-kit/migrations.js";
import { SECRETS_MIGRATIONS } from "../src/server/cloud-migrations.js";
import { tenantStore } from "../src/server/tenant-client.js";

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

// Each invocation owns its schema and serving role. The test DSN needs schema
// and role creation privileges; ordinary operations run without RLS bypass.
const suffix = randomUUID().replaceAll("-", "");
const schema = `secrets_gate_${suffix}`;
const role = `secrets_gate_role_${suffix}`;
const admin = createQueryClient(createPgPool({ connectionString }));
let fixture: ReturnType<typeof createQueryClient> | undefined;
let runtime: ReturnType<typeof createQueryClient> | undefined;
let schemaCreated = false;
let roleCreated = false;
let passed = false;
function fixtureUrl(serving = false): string {
  const url = new URL(connectionString!);
  url.searchParams.set("options", `-c search_path=${schema}${serving ? ` -c role=${role}` : ""}`);
  return url.toString();
}

try {
  await admin.execute(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  fixture = createQueryClient(createPgPool({ connectionString: fixtureUrl() }));
  await new MigrationLedger(fixture, SECRETS_MIGRATIONS).migrate();
  await admin.execute(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  roleCreated = true;
  await admin.execute(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  await admin.execute(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
  await admin.execute(`REVOKE ALL ON ${schema}.secret_key_owners FROM ${role}`);
  await admin.execute(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
  runtime = createQueryClient(createPgPool({ connectionString: fixtureUrl(true) }));

  const tenant = randomUUID();
  const scopes = ["secrets:read", "secrets:write"];
  await fixture.execute("INSERT INTO tenants(id,slug,name) VALUES($1,$2,'PG gate fixture')", [tenant, tenant]);
  const key = mintApiKey({ app: "secrets", scopes, signingSecret: randomBytes(32).toString("hex") });
  await new ApiKeyStore(fixture).insertMinted(key);
  await fixture.execute("UPDATE api_keys SET tenant_id=$1 WHERE kid=$2", [tenant, key.kid]);
  const store = tenantStore(runtime, tenant, key.kid, scopes);
  const probeKey = `pg-gate-${randomUUID()}/api_key`;
  const probeValue = randomBytes(32).toString("hex");
  await store.setSecret(probeKey, probeValue, "api_key", "pg-gate-probe", undefined, key.kid, tenant);
  const readBack = await store.getSecret(probeKey, key.kid, tenant);
  if (!readBack || readBack.key !== probeKey || readBack.value !== probeValue) {
    throw new Error("Scoped secret read-back did not match the synthetic write");
  }
  if (!await store.deleteSecret(probeKey, key.kid, tenant) || await store.getSecret(probeKey, key.kid, tenant)) {
    throw new Error("Scoped secret deletion did not complete");
  }
  passed = true;
} catch {
  // Do not echo driver errors: a failed SQL statement can include bound data.
  console.error("[pg-test-gate] FAIL: isolated schema, serving-role setup or scoped write/read/delete proof failed");
  process.exitCode = 1;
} finally {
  try {
    await runtime?.close();
    await fixture?.close();
    if (schemaCreated) await admin.execute(`DROP SCHEMA ${schema} CASCADE`);
    if (roleCreated) await admin.execute(`DROP ROLE ${role}`);
  } catch {
    console.error("[pg-test-gate] FAIL: fixture cleanup failed");
    process.exitCode = 1;
  } finally {
    await admin.close();
  }
}
if (passed && !process.exitCode) {
  console.log("[pg-test-gate] ok — migrations + tenant-scoped CloudSecretsStore write/read/delete round-trip; fixture removed");
}
