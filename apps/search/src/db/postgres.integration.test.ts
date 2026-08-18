// Live-PostgreSQL integration proof for @hasna/search's remote storage
// (hasna.service_contract.v1 storage.pgTestGate target).
//
// Runs only when a database URL is configured. The gate wiring is:
//   HASNA_SEARCH_DATABASE_URL=$HASNA_SEARCH_TEST_DATABASE_URL bun run test:postgres
// and `test:postgres` sets HASNA_SEARCH_REQUIRE_POSTGRES_TEST=1 so a gate run
// with no URL FAILS CLOSED instead of silently skipping.

import { afterAll, describe, expect, test } from "bun:test";
import { applyPgMigrations } from "./pg-migrate.js";
import { PgAdapterAsync } from "./remote-storage.js";
import { SEARCH_STORAGE_ENV, SEARCH_STORAGE_FALLBACK_ENV } from "./storage-config.js";

const databaseUrl = process.env[SEARCH_STORAGE_ENV] ?? process.env[SEARCH_STORAGE_FALLBACK_ENV];
const postgresTestRequired = process.env.HASNA_SEARCH_REQUIRE_POSTGRES_TEST === "1";

if (postgresTestRequired && !databaseUrl) {
  throw new Error(
    `PostgreSQL integration tests require ${SEARCH_STORAGE_ENV} or ${SEARCH_STORAGE_FALLBACK_ENV} to be set`
  );
}

const describeLivePostgres = databaseUrl ? describe : describe.skip;

describeLivePostgres("search remote storage against live PostgreSQL", () => {
  let pg: PgAdapterAsync | undefined;

  afterAll(async () => {
    if (pg) {
      await pg.close();
    }
  });

  test("pg migrations apply and the adapter round-trips a searches row", async () => {
    pg = new PgAdapterAsync(databaseUrl!);
    await applyPgMigrations(databaseUrl!);

    const id = `pg-integration-${Date.now()}`;
    await pg.run(
      "INSERT INTO searches (id, query, providers) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING",
      id,
      "live postgres probe",
      '["hackernews"]'
    );

    const row = (await pg.get("SELECT id, query, providers FROM searches WHERE id = ?", id)) as
      | { id: string; query: string; providers: string }
      | undefined;
    expect(row).toBeTruthy();
    expect(row!.id).toBe(id);
    expect(row!.query).toBe("live postgres probe");

    await pg.run("DELETE FROM searches WHERE id = ?", id);
    const gone = (await pg.get("SELECT id FROM searches WHERE id = ?", id)) as unknown;
    expect(gone).toBeNull();
  });
});
