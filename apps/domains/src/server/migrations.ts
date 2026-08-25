/**
 * Cloud Postgres migrations for domains-serve.
 *
 * Combines the app schema (`PG_MIGRATIONS`) with the vendored storage kit's
 * checksum-guarded `MigrationLedger` and the @hasna/contracts api-keys table.
 * Runs against the OWNER role DSN (DDL), not the request-path app role.
 *
 * PURE REMOTE (Amendment A1): migrations run against the cloud Postgres. There
 * is no local schema and no ledger sync between machines.
 */

import { apiKeyMigrations } from "@hasna/contracts/auth";
import {
  MigrationLedger,
  defineMigration,
  type Migration,
  type MigrationResult,
} from "../generated/storage-kit/index.js";
import { createPgPool } from "../generated/storage-kit/index.js";
import { wrapExecutor } from "../generated/storage-kit/index.js";
import { PG_MIGRATIONS } from "../db/pg-migrations.js";

/** Env var holding the owner-role DSN (DDL privileges). Falls back to the app DSN. */
export const OWNER_DSN_ENV = "HASNA_DOMAINS_DATABASE_URL_OWNER";
export const APP_DSN_ENV = "HASNA_DOMAINS_DATABASE_URL";
const LEGACY_DSN_ENV = "DATABASE_URL";

/** The ordered migration set: app schema first, then the shared api-keys table. */
export function buildMigrations(): Migration[] {
  const migrations: Migration[] = [];
  PG_MIGRATIONS.forEach((sql, i) => {
    const id = `domains_${String(i + 1).padStart(4, "0")}`;
    migrations.push(defineMigration(id, sql));
  });
  for (const m of apiKeyMigrations("api_keys")) {
    migrations.push(defineMigration(m.id, m.sql));
  }
  return migrations;
}

function resolveMigrationDsn(env: NodeJS.ProcessEnv = process.env): string {
  const dsn = env[OWNER_DSN_ENV] || env[APP_DSN_ENV] || env[LEGACY_DSN_ENV];
  if (!dsn) {
    throw new Error(
      `No database URL for migrations. Set ${OWNER_DSN_ENV} (owner role) or ${APP_DSN_ENV}.`,
    );
  }
  return dsn;
}

/** Run all pending migrations against the owner DSN. */
export async function runMigrations(
  opts: { dryRun?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<MigrationResult> {
  const env = opts.env ?? process.env;
  const dsn = resolveMigrationDsn(env);
  const pool = createPgPool({ connectionString: dsn, env, applicationName: "domains-migrate" });
  try {
    const client = wrapExecutor(pool);
    // O15-00671: the prod ledger carries `domains_apikeys_tenancy_0001`, an
    // out-of-band row from the 2026-07 self-hosted cutover that no published
    // build ever generated. Acknowledge it so the downgrade guard passes and
    // the row is never checksum-compared or re-applied.
    const ledger = new MigrationLedger(client, buildMigrations(), {
      acknowledgedLegacyIds: ["domains_apikeys_tenancy_0001"],
    });
    return await ledger.migrate(opts.dryRun ? { dryRun: true } : {});
  } finally {
    await pool.end();
  }
}
