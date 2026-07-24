#!/usr/bin/env bun
/**
 * Apply the @hasna/knowledge operator-only Postgres schema via the vendored
 * storage kit's MigrationLedger (checksum ledger + drift/downgrade guards).
 *
 * Stage A keeps this capability outside public CLI/SDK/server authority. The
 * bundled migration target runs only as an explicitly supervised operator task.
 * It requires:
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
import { PG_MIGRATIONS } from '../src/db/pg-migrations.ts';
import { createKnowledgeCloudClient } from '../src/db/remote-storage.ts';
import { MigrationLedger, defineMigration } from '../src/generated/storage-kit/index.ts';
import { createKnowledgeOperatorCapability } from '../src/operator-capability.ts';
import { apiKeyMigrations } from '@hasna/contracts/auth';

const dryRun = process.argv.includes('--dry-run');
const asJson = process.argv.includes('--json');

// Migrations run DDL and therefore need the DB OWNER role. Prefer an
// owner-scoped DSN when one is injected (HASNA_KNOWLEDGE_DATABASE_URL_OWNER),
// falling back to the standard app DSN for local/dev runs. The resolved value
// is written to HASNA_KNOWLEDGE_DATABASE_URL so the cloud client picks it up.
// Also restore kit-intended sslmode=require semantics under node-postgres
// >= 8.22 (see src/serve.ts::normalizeCloudDatabaseUrl). Never logs the URL.
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

// The extension migration must run before the table DDL that relies on
// gen_random_uuid()/pgcrypto. Kept first and stable.
//
// The api-keys ledger (from @hasna/contracts/auth) backs the serve API-key
// auth middleware. Its ids are namespaced ("api_keys_*") so they never clash
// with the knowledge_pg_* schema migrations, and they run last (additive).
const migrations = [
  defineMigration('knowledge_pg_000_extensions', 'CREATE EXTENSION IF NOT EXISTS pgcrypto'),
  ...PG_MIGRATIONS.map((sql, index) =>
    defineMigration(`knowledge_pg_${String(index + 1).padStart(3, '0')}`, sql),
  ),
  ...apiKeyMigrations().map((m) => defineMigration(m.id, m.sql)),
];

const operatorCapability = createKnowledgeOperatorCapability('scripts/apply-cloud-migrations.mjs');
const client = createKnowledgeCloudClient(operatorCapability, process.env);
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
