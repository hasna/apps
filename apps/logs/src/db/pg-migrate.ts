/**
 * Cloud (PostgreSQL) migration runner for @hasna/logs.
 *
 * Migrations run directly against the shared cloud Postgres using the vendored
 * storage kit's {@link MigrationLedger}. The
 * ledger records each migration once, guards against silent SQL drift
 * (checksum mismatch) and against running against a newer schema (downgrade).
 *
 * Two logical migrations are shipped:
 *   - `0001_logs_pg_schema` — the full @hasna/logs relational schema
 *     (projects, pages, logs, event_records, test_reports, …), taken verbatim
 *     from {@link PG_MIGRATIONS}.
 *   - the API-key auth table migrations from `@hasna/contracts/auth`
 *     (`api_keys` + indexes) so the serve can authenticate keys against RDS.
 */

import { apiKeyMigrations } from "@hasna/contracts/auth";
import {
  type Migration,
  MigrationLedger,
  type MigrationResult,
  createServerPoolFromEnv,
  defineMigration,
} from "../generated/storage-kit/index.ts";
import { LOG_IDENTITY_FIELDS_SQL } from "./migrations/006_logs_identity_fields.ts";
import { PG_MIGRATIONS } from "./pg-migrations.ts";

export const LOGS_APP_NAME = "logs";

/** Ordered cloud migrations for @hasna/logs (schema + auth). */
export function logsCloudMigrations(): Migration[] {
  const schema = defineMigration(
    "0001_logs_pg_schema",
    PG_MIGRATIONS.map((sql) => sql.trim().replace(/;+$/, "")).join(";\n"),
  );
  // Hosted per-line logs keep their deterministic client id and run/process/
  // privacy/page linkage (todos 9429baa0). Must be its own migration id: adding
  // the columns to 0001's CREATE TABLE would change that migration's checksum
  // and the ledger refuses already-applied databases.
  const identity = defineMigration("0002_logs_identity_fields", LOG_IDENTITY_FIELDS_SQL);
  const auth = apiKeyMigrations().map((m) => defineMigration(m.id, m.sql));
  return [schema, identity, ...auth];
}

export interface RunMigrationsOptions {
  /** Report the plan without mutating anything. */
  dryRun?: boolean;
  /** Application name reported to Postgres. */
  applicationName?: string;
}

/**
 * Environment for migrations. Migrations run DDL (CREATE TABLE …), so they need
 * the owning role. When `HASNA_LOGS_OWNER_DATABASE_URL` is set (the ECS
 * migration task injects the owner DSN there) it takes precedence over the
 * least-privileged app DSN the service itself uses. The owner DSN selects the
 * postgresql backend for migration runs.
 */
function migrationEnv(): Record<string, string | undefined> {
  const owner =
    process.env.HASNA_LOGS_OWNER_DATABASE_URL?.trim() ||
    process.env.LOGS_OWNER_DATABASE_URL?.trim();
  return {
    ...process.env,
    ...(owner ? { HASNA_LOGS_DATABASE_URL: owner } : {}),
  };
}

/**
 * Build a cloud pool from the environment, run all pending migrations, and
 * close the pool. Requires a cloud database URL (owner DSN preferred).
 */
export async function runLogsCloudMigrations(
  options: RunMigrationsOptions = {},
): Promise<MigrationResult> {
  const { client } = createServerPoolFromEnv(LOGS_APP_NAME, {
    applicationName: options.applicationName ?? "logs-migrate",
    max: 4,
    env: migrationEnv(),
  });
  try {
    const ledger = new MigrationLedger(client, logsCloudMigrations());
    return await ledger.migrate({ dryRun: options.dryRun ?? false });
  } finally {
    await client.close();
  }
}
