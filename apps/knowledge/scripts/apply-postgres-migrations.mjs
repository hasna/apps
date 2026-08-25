#!/usr/bin/env bun
/**
 * Apply the @hasna/knowledge PostgreSQL schema via the vendored
 * storage kit's MigrationLedger (checksum ledger + drift/downgrade guards).
 *
 * Runs against the server PostgreSQL database only. Requires:
 *   HASNA_KNOWLEDGE_DATABASE_URL=postgres://...   (never logged)
 *
 * Usage:
 *   bun scripts/apply-postgres-migrations.mjs [--dry-run] [--json]
 *
 * The DATABASE_URL value is never printed or captured. Inject it through the
 * runtime's credential consumer before starting this script.
 */
import {
  buildKnowledgePostgresMigrations,
  MigrationLedger,
  createKnowledgeDatabaseClient,
} from '../dist/serve.js';

const dryRun = process.argv.includes('--dry-run');
const asJson = process.argv.includes('--json');

// Migrations run DDL and therefore need the DB OWNER role. Prefer an
// owner-scoped DSN when one is injected (HASNA_KNOWLEDGE_DATABASE_URL_OWNER),
// falling back to the standard app DSN for local/dev runs. The resolved value
// is written to HASNA_KNOWLEDGE_DATABASE_URL so the database client picks it up.
// Also restore kit-intended sslmode=require semantics under node-postgres
// >= 8.22 (see src/serve.ts::normalizePostgresDatabaseUrl). Never logs the URL.
{
  const key = 'HASNA_KNOWLEDGE_DATABASE_URL';
  let url = process.env.HASNA_KNOWLEDGE_DATABASE_URL_OWNER ?? process.env[key];
  if (url) {
    const lower = url.toLowerCase();
    if (
      (lower.includes('sslmode=require') || lower.includes('sslmode=prefer')) &&
      !lower.includes('uselibpqcompat')
    ) {
      url = url.includes('?') ? `${url}&uselibpqcompat=true` : `${url}?uselibpqcompat=true`;
    }
    process.env[key] = url;
  }
}

// ONE ordered migration program (extensions -> knowledge_pg_* -> project links
// -> api keys -> rc.6 tenancy), composed by buildKnowledgePostgresMigrations in
// src/db/migrate-list.ts. The id scheme matches the ledger the prod DB was
// migrated under (O15-00684); the same builder is exercised by
// tests/legacy-ledger-compat.test.ts so the composed list cannot drift from
// what the tests pin.
const migrations = buildKnowledgePostgresMigrations();

const client = createKnowledgeDatabaseClient();
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
    console.log(`[knowledge] migrations ${dryRun ? 'plan (dry-run)' : 'applied'}: total=${summary.total} already=${summary.alreadyApplied} pending=${pending.length}`);
    if (pending.length) console.log(`[knowledge] pending: ${pending.join(', ')}`);
  }
} finally {
  await client.close();
}
