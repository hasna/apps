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
 */
import {
  notesPgMigrations,
} from '../server/pg-migrations.ts';
import {
  MigrationLedger,
} from '../src/generated/storage-kit/index.js';
import { createQueryClient, createPgPool } from '../src/generated/storage-kit/index.js';

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
  const ledger = new MigrationLedger(client, notesPgMigrations());
  const result = await ledger.migrate({ dryRun });
  const pending = result.plan.filter((item) => item.state === 'pending').map((item) => item.migration.id);
  const summary = {
    ok: true,
    dryRun,
    total: notesPgMigrations().length,
    alreadyApplied: result.plan.length - pending.length,
    pending,
  };
  if (asJson) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`[notes] migrations ${dryRun ? 'plan (dry-run)' : 'applied'}: total=${summary.total} already=${summary.alreadyApplied} pending=${pending.length}`);
    if (pending.length) console.log(`[notes] pending: ${pending.join(', ')}`);
  }
} finally {
  await client.close();
}
