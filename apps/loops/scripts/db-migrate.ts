#!/usr/bin/env bun
// Standalone migration runner for the loops Postgres backend.
//
// Applies POSTGRES_STORAGE_MIGRATIONS (the ledger-tracked schema) to the database identified by the resolved
// DSN. This is the same code path the `loops-serve migrate` command uses; it is
// exposed as a script so operators can apply the schema out-of-band (e.g. as the
// owner role through an SSM tunnel) before the least-privileged service role
// ever connects.
//
import { PgPoolExecutor } from "../src/lib/storage/pg-executor.js";
import { PostgresStorage } from "../src/lib/storage/postgres.js";
import { runGuardedPostgresMigrations } from "../src/serve/index.js";

function resolveDsn(): string {
  const dsn = process.env.HASNA_LOOPS_MIGRATOR_DATABASE_URL?.trim();
  if (!dsn) {
    throw new Error("no migrator database URL: set HASNA_LOOPS_MIGRATOR_DATABASE_URL");
  }
  return dsn;
}

export async function runMigrations(dsn = resolveDsn()): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const enforceTenancy = process.argv.includes("--enforce-tenancy");
  const identityAliases = process.argv.includes("--identity-aliases");
  const executor = PgPoolExecutor.fromConnectionString({
    connectionString: dsn,
    applicationName: "loops-migrate",
    max: 2,
  });
  try {
    const schema = new PostgresStorage(executor);
    const result = await runGuardedPostgresMigrations(executor.queryClient, schema, {
      dryRun,
      enforceTenancy,
      identityAliases,
    });
    const pending = result.plan.filter((p) => p.state === "pending").map((p) => p.migration.id);
    console.log(
      JSON.stringify({
        step: "storage",
        backend: result.backend,
        dryRun: result.dryRun,
        enforceTenancy,
        identityAliases,
        applied: result.applied.map((a) => a.id),
        pending,
      }),
    );
  } finally {
    await executor.close();
  }
}

if (import.meta.main) {
  runMigrations().catch((error) => {
    logMigrationFailure(error);
    process.exit(1);
  });
}

export function logMigrationFailure(error: unknown): void {
  console.error(JSON.stringify({
    evt: "loops_migrate_failed",
    errorType: error instanceof Error ? "error" : typeof error,
  }));
}
