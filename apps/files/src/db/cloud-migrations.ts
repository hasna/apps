/**
 * Ordered cloud (Postgres) migrations for the open-files self-hosted service.
 *
 * Combines the canonical data-plane schema (PG_MIGRATIONS) with the shared
 * @hasna/contracts api_keys migrations, wrapped in the vendored storage kit's
 * `defineMigration` so they run through the drift/downgrade-guarded
 * `MigrationLedger`.
 *
 * PURE REMOTE (Amendment A1): the service reads AND writes these tables in
 * cloud Postgres directly. There is no sync engine in the service.
 */
import { apiKeyMigrations } from "@hasna/contracts/auth";
import { defineMigration, type Migration } from "../generated/storage-kit/index.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";

/** Data-plane schema, one ledger entry per statement, stable zero-padded ids. */
const dataMigrations: Migration[] = PG_MIGRATIONS.map((sql, index) =>
  defineMigration(`files-${String(index + 1).padStart(4, "0")}`, sql),
);

/** Shared api_keys table + indexes from @hasna/contracts. */
const authMigrations: Migration[] = apiKeyMigrations().map((m) =>
  defineMigration(m.id, m.sql),
);

/** Full ordered migration set applied by the runner and checked by /ready. */
export const CLOUD_MIGRATIONS: readonly Migration[] = [...dataMigrations, ...authMigrations];
