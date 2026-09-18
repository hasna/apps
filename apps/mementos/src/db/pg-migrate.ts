/**
 * PostgreSQL migration runner — applies PG_MIGRATIONS to an RDS instance.
 *
 * Tracks applied migrations in a `_pg_migrations` table (separate from the
 * `_migrations` table used within individual migration SQL blocks).
 */
import {
  PgAdapterAsync,
  getStorageConnectionStringForOperator,
  redactDatabaseUrl,
  validatePostgresConnectionString,
} from "../storage.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";

export interface PgMigrationResult {
  applied: number[];
  alreadyApplied: number[];
  errors: string[];
  totalMigrations: number;
}

export interface PgMigrationDiagnostics {
  ok: boolean;
  target: "postgres-rds-compatible";
  configured: boolean;
  redacted_connection_string: string | null;
  total_migrations: number;
  mutates_remote_on_apply: true;
  requires_approval_for_live_run: true;
  no_network: true;
  issues: string[];
  warnings: string[];
}

export function getPgMigrationDiagnostics(
  connectionString?: string
): PgMigrationDiagnostics {
  let resolvedConnectionString: string | null = connectionString ?? null;
  const issues: string[] = [];

  if (!resolvedConnectionString) {
    try {
      // The migrate module is the operator surface: the explicitly-invoked
      // `storage migrate` command (and its MCP/CLI siblings) resolves the
      // env/config DSN without the client-context guard. Every client DATA
      // path still fails closed in getStorageConnectionString (O15-02695).
      resolvedConnectionString = getStorageConnectionStringForOperator("mementos");
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (resolvedConnectionString) {
    const validation = validatePostgresConnectionString(resolvedConnectionString);
    if (!validation.ok) {
      issues.push(...validation.issues);
    }
  }

  return {
    ok: issues.length === 0,
    target: "postgres-rds-compatible",
    configured: resolvedConnectionString !== null && issues.length === 0,
    redacted_connection_string: redactDatabaseUrl(resolvedConnectionString),
    total_migrations: PG_MIGRATIONS.length,
    mutates_remote_on_apply: true,
    requires_approval_for_live_run: true,
    no_network: true,
    issues,
    warnings: [
      "Dry-run diagnostics do not connect to PostgreSQL/RDS and do not mutate AWS or production data.",
      "Applying migrations is a live remote database mutation and requires explicit approval for production targets.",
    ],
  };
}

/**
 * Apply all pending PostgreSQL migrations to the given database.
 *
 * @param connectionString - PostgreSQL connection string
 * @returns Summary of which migrations were applied / skipped / errored.
 */
export async function applyPgMigrations(
  connectionString: string
): Promise<PgMigrationResult> {
  const validation = validatePostgresConnectionString(connectionString);
  if (!validation.ok) {
    throw new Error(
      `Remote storage database is not configured. ${validation.issues.join(" ")}`
    );
  }

  const pg = new PgAdapterAsync(connectionString);

  const result: PgMigrationResult = {
    applied: [],
    alreadyApplied: [],
    errors: [],
    totalMigrations: PG_MIGRATIONS.length,
  };

  try {
    // Bootstrap the ledger under the same transaction-level advisory lock used
    // by every migration. Two fresh deploy jobs must not race CREATE TABLE.
    const migrationLockKey = 21760041;
    await pg.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [migrationLockKey]);
      await client.query(
        `CREATE TABLE IF NOT EXISTS _pg_migrations (
          id SERIAL PRIMARY KEY,
          version INT UNIQUE NOT NULL,
          applied_at TIMESTAMPTZ DEFAULT NOW()
        )`,
      );
    });

    // Each migration and its receipt are one transaction. The transaction-level
    // advisory lock serializes concurrent deploy jobs, and the in-lock receipt
    // check makes crash/retry behavior idempotent.
    for (let i = 0; i < PG_MIGRATIONS.length; i++) {
      try {
        const outcome = await pg.transaction(async (client) => {
          await client.query("SELECT pg_advisory_xact_lock($1)", [migrationLockKey]);
          const already = await client.query(
            "SELECT 1 FROM _pg_migrations WHERE version = $1",
            [i],
          );
          if (already.rowCount) return "already" as const;
          await client.query(PG_MIGRATIONS[i]!);
          await client.query(
            "INSERT INTO _pg_migrations (version) VALUES ($1)",
            [i],
          );
          return "applied" as const;
        });
        if (outcome === "already") result.alreadyApplied.push(i);
        else result.applied.push(i);
      } catch (error) {
        result.errors.push(
          `Migration ${i}: ${error instanceof Error ? error.message : String(error)}`
        );
        break;
      }
    }
  } finally {
    await pg.close();
  }

  return result;
}
