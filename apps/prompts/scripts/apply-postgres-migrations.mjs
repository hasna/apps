#!/usr/bin/env bun
/**
 * Apply the @hasna/prompts PostgreSQL schema via the vendored storage kit's
 * MigrationLedger (sha256 checksum ledger + drift/downgrade guards).
 *
 * Runs against the server PostgreSQL database only. Requires:
 *   HASNA_PROMPTS_DATABASE_URL=postgres://...   (never logged)
 *
 * Usage:
 *   bun scripts/apply-postgres-migrations.mjs [--dry-run] [--json]
 *
 * The DATABASE_URL value is never printed or captured. Inject it through the
 * runtime's credential consumer before starting this script.
 */
import { PG_MIGRATIONS } from '../src/db/pg-migrations.ts';
import { MigrationLedger, defineMigration } from '../src/generated/storage-kit/migrations.ts';
import { createServerPoolFromEnv } from '../src/generated/storage-kit/pool.ts';
import { apiKeyMigrations } from '@hasna/contracts/auth';

const dryRun = process.argv.includes('--dry-run');
const asJson = process.argv.includes('--json');

// Migrations run DDL and therefore need the DB OWNER role. Prefer an
// owner-scoped DSN when one is injected (HASNA_PROMPTS_DATABASE_URL_OWNER),
// falling back to the standard app DSN for local/dev runs. The resolved value
// is written to HASNA_PROMPTS_DATABASE_URL so the kit client picks it up.
// Never logs the URL.
{
  const url = process.env.HASNA_PROMPTS_DATABASE_URL_OWNER ?? process.env.HASNA_PROMPTS_DATABASE_URL;
  if (url) process.env.HASNA_PROMPTS_DATABASE_URL = url;
}

// The extensions migration must run before table DDL that relies on
// gen_random_uuid()/pgcrypto. The api-keys ledger (from @hasna/contracts/auth)
// backs the serve API-key auth middleware; its ids are namespaced so they
// never clash with the prompts_pg_* schema migrations, and they run last
// (additive).
const migrations = [
  defineMigration('prompts_pg_000_extensions', 'CREATE EXTENSION IF NOT EXISTS pgcrypto'),
  ...PG_MIGRATIONS.map((sql, index) =>
    defineMigration(`prompts_pg_${String(index + 1).padStart(3, '0')}`, sql),
  ),
  ...apiKeyMigrations().map((m) => defineMigration(m.id, m.sql)),
];

const { client } = createServerPoolFromEnv('prompts');
try {
  const ledger = new MigrationLedger(client, migrations);
  const result = await ledger.migrate({ dryRun });
  const pending = result.plan.filter((item) => item.state === 'pending').map((item) => item.migration.id);
  const summary = {
    ok: true,
    dryRun,
    total: migrations.length,
    alreadyApplied: result.plan.length - pending.length,
    pending,
  };
  if (asJson) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`[prompts] migrations ${dryRun ? 'plan (dry-run)' : 'applied'}: total=${summary.total} already=${summary.alreadyApplied} pending=${pending.length}`);
    if (pending.length) console.log(`[prompts] pending: ${pending.join(', ')}`);
  }
} finally {
  await client.close();
}
