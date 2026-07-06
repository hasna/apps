#!/usr/bin/env bun
/**
 * Apply the @hasna/knowledge cloud-mode Postgres schema via the vendored
 * storage kit's MigrationLedger (checksum ledger + drift/downgrade guards).
 *
 * PURE REMOTE (Amendment A1): runs against the cloud Postgres only. Requires:
 *   HASNA_KNOWLEDGE_STORAGE_MODE=cloud
 *   HASNA_KNOWLEDGE_DATABASE_URL=postgres://...   (never logged)
 *
 * Usage:
 *   bun scripts/apply-cloud-migrations.mjs [--dry-run] [--json]
 *
 * The DATABASE_URL value is never printed. Fetch it into the environment from
 * Secrets Manager without echoing, e.g.:
 *   export HASNA_KNOWLEDGE_DATABASE_URL="$(aws secretsmanager get-secret-value \
 *     --secret-id hasna/oss/knowledge/database-url --query SecretString --output text)"
 */
import {
  PG_MIGRATIONS,
  MigrationLedger,
  defineMigration,
  createKnowledgeCloudClient,
} from '../src/storage.ts';

const dryRun = process.argv.includes('--dry-run');
const asJson = process.argv.includes('--json');

// The extension migration must run before the table DDL that relies on
// gen_random_uuid()/pgcrypto. Kept first and stable.
const migrations = [
  defineMigration('knowledge_pg_000_extensions', 'CREATE EXTENSION IF NOT EXISTS pgcrypto'),
  ...PG_MIGRATIONS.map((sql, index) =>
    defineMigration(`knowledge_pg_${String(index + 1).padStart(3, '0')}`, sql),
  ),
];

const client = createKnowledgeCloudClient();
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
