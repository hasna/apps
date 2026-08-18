// Live-PostgreSQL integration proof for @hasna/tenants
// (hasna.service_contract.v1 storage.pgTestGate target).
//
// The gate wiring is:
//   HASNA_TENANTS_DATABASE_URL=$HASNA_TENANTS_TEST_DATABASE_URL bun run test:postgres
// and `test:postgres` sets HASNA_TENANTS_REQUIRE_POSTGRES_TEST=1 so a gate run
// with no URL FAILS CLOSED instead of silently skipping.

import { afterAll, describe, expect, test } from "bun:test";
import { createTenantsDatabase, runTenantsMigrations } from "./db.js";
import { API_KEYS_TABLE } from "./migrations.js";
import type { Env } from "./storage.js";

const databaseUrl = process.env.HASNA_TENANTS_DATABASE_URL ?? process.env.TENANTS_DATABASE_URL;
const postgresTestRequired = process.env.HASNA_TENANTS_REQUIRE_POSTGRES_TEST === "1";

if (postgresTestRequired && !databaseUrl) {
  throw new Error(
    "PostgreSQL integration tests require HASNA_TENANTS_DATABASE_URL or TENANTS_DATABASE_URL"
  );
}

const describeLivePostgres = databaseUrl ? describe : describe.skip;

describeLivePostgres("tenants database against live PostgreSQL", () => {
  let db: ReturnType<typeof createTenantsDatabase> | undefined;

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  test("migrations apply and a tenant row round-trips through the query client", async () => {
    const env: Env = { HASNA_TENANTS_DATABASE_URL: databaseUrl! };
    db = createTenantsDatabase({ env });
    await runTenantsMigrations(db.client);

    const id = `pg-integration-${Date.now()}`;
    const createdAt = new Date().toISOString();
    await db.client.run(
      `INSERT INTO tenants (id, name, created_at, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      id,
      "live postgres probe",
      createdAt,
      createdAt,
    );

    const row = (await db.client.get("SELECT id, name FROM tenants WHERE id = $1", id)) as
      | { id: string; name: string }
      | undefined;
    expect(row).toBeTruthy();
    expect(row!.id).toBe(id);
    expect(row!.name).toBe("live postgres probe");

    await db.client.run("DELETE FROM tenants WHERE id = $1", id);
    const gone = (await db.client.get("SELECT id FROM tenants WHERE id = $1", id)) as unknown;
    expect(gone).toBeNull();

    const apiKeysTable = (await db.client.get(
      `SELECT to_regclass('public.${API_KEYS_TABLE}') AS t`,
    )) as { t: string | null };
    expect(apiKeysTable.t).toBeTruthy();
  });
});
