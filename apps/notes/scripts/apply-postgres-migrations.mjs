#!/usr/bin/env bun
/**
 * Apply the notes PostgreSQL schema via the vendored storage kit's
 * MigrationLedger (checksum ledger + drift/downgrade guards).
 *
 * Runs against the server PostgreSQL database only. Requires:
 *   HASNA_NOTES_DATABASE_URL=postgres://...   (never logged)
 *
 * Usage:
 *   bun scripts/apply-postgres-migrations.mjs [--dry-run] [--json]
 *
 * The DATABASE_URL value is never printed or captured. Inject it through the
 * runtime's credential consumer before starting this script.
 *
 * The summary builder is exported so regression tests can exercise the exact
 * derivation this script reports; the executable body runs only when this
 * file is the entrypoint (import.meta.main).
 */
import {
  notesPgMigrations,
} from '../server/pg-migrations.ts';
import {
  MigrationLedger,
} from '../src/generated/storage-kit/index.js';
import { createQueryClient, createPgPool } from '../src/generated/storage-kit/index.js';

/**
 * Summarize a MigrationLedger result for the runner's report.
 *
 * MUST derive from `result.applied` — the ledger re-reads the applied set
 * AFTER the apply loop (fresh), while `result.plan` is computed BEFORE it and
 * is stale on any run that applies something. Deriving from `plan` made a
 * first apply report the inverse of the measured outcome: it applied every
 * migration (schema_migrations ledger fully populated, verified against the
 * database) and then printed `alreadyApplied: 0` and `pending: [all]`.
 */
export function buildMigrationSummary(migrations, result, dryRun) {
  const appliedIds = new Set(result.applied.map((item) => item.id));
  const pending = migrations.map((m) => m.id).filter((id) => !appliedIds.has(id));
  return {
    ok: true,
    dryRun,
    total: migrations.length,
    alreadyApplied: result.applied.length,
    pending,
  };
}

if (import.meta.main) {
  const dryRun = process.argv.includes('--dry-run');
  const asJson = process.argv.includes('--json');

  // Migrations run DDL and therefore need the DB OWNER role. Prefer an
  // owner-scoped DSN when one is injected (HASNA_NOTES_DATABASE_URL_OWNER),
  // falling back to the standard app DSN for local/dev runs. The resolved value
  // is written to HASNA_NOTES_DATABASE_URL so the database client picks it up.
  // Never logs the URL.
  {
    const key = 'HASNA_NOTES_DATABASE_URL';
    const url = process.env.HASNA_NOTES_DATABASE_URL_OWNER ?? process.env[key];
    if (!url) {
      process.stderr.write(
        `[notes] ${key} is not set. This runner applies the PostgreSQL schema and ` +
        `cannot run without a PostgreSQL DSN; set ${key} (or HASNA_NOTES_DATABASE_URL_OWNER) via the runtime's credential consumer.\n`,
      );
      process.exit(1);
    }
    process.env[key] = url;
  }

  const client = createQueryClient(createPgPool({
    connectionString: process.env.HASNA_NOTES_DATABASE_URL,
    applicationName: '@hasna/notes',
  }));
  try {
    const migrations = notesPgMigrations();
    const ledger = new MigrationLedger(client, migrations);
    const result = await ledger.migrate({ dryRun });
    const summary = buildMigrationSummary(migrations, result, dryRun);
    if (asJson) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(`[notes] migrations ${dryRun ? 'plan (dry-run)' : 'applied'}: total=${summary.total} already=${summary.alreadyApplied} pending=${summary.pending.length}`);
      if (summary.pending.length) console.log(`[notes] pending: ${summary.pending.join(', ')}`);
    }
  } finally {
    await client.close();
  }
}
