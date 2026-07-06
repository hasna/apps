#!/usr/bin/env bun
// Standalone migration runner for the loops Postgres backend.
//
// Applies POSTGRES_STORAGE_MIGRATIONS (the ledger-tracked schema) plus the
// @hasna/contracts api_keys table to the database identified by the resolved
// DSN. This is the same code path the `loops-serve migrate` command uses; it is
// exposed as a script so operators can apply the schema out-of-band (e.g. as the
// owner role through an SSM tunnel) before the least-privileged service role
// ever connects.
//
// DSN resolution (first match wins):
//   HASNA_LOOPS_DATABASE_URL | LOOPS_DATABASE_URL | DATABASE_URL
import { ApiKeyStore } from "@hasna/contracts/auth";
import { PgPoolExecutor } from "../src/lib/storage/pg-executor.js";
import { PostgresStorage } from "../src/lib/storage/postgres.js";

function resolveDsn(): string {
  const dsn =
    process.env.HASNA_LOOPS_DATABASE_URL?.trim() ||
    process.env.LOOPS_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!dsn) {
    throw new Error(
      "no database URL: set HASNA_LOOPS_DATABASE_URL, LOOPS_DATABASE_URL, or DATABASE_URL",
    );
  }
  return dsn;
}

export async function runMigrations(dsn = resolveDsn()): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const executor = PgPoolExecutor.fromConnectionString({
    connectionString: dsn,
    applicationName: "loops-migrate",
    max: 2,
  });
  try {
    const schema = new PostgresStorage(executor);
    const result = await schema.migrate({ dryRun });
    const pending = result.plan.filter((p) => p.state === "pending").map((p) => p.migration.id);
    console.log(
      JSON.stringify({
        step: "storage",
        backend: result.backend,
        dryRun: result.dryRun,
        applied: result.applied.map((a) => a.id),
        pending,
      }),
    );
    if (!dryRun) {
      // api_keys table (contracts auth). Shares the same client/pool.
      const client = executor.queryClient;
      const keys = new ApiKeyStore(client);
      await keys.ensureSchema();
      console.log(JSON.stringify({ step: "api_keys", ensured: true }));
    }
  } finally {
    await executor.close();
  }
}

if (import.meta.main) {
  runMigrations().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
