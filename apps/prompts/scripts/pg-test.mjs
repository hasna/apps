#!/usr/bin/env bun
/**
 * Live PostgreSQL gate declared by hasna.contract.json storage.pgTestGate.
 *
 * Requires HASNA_PROMPTS_PG_TEST_DATABASE_URL to point at a disposable test
 * database; runs the migration ledger (including the api_keys schema) and a
 * minimal smoke: create one prompt through the PG store and read it back.
 * Fails closed when the variable is absent — absence is a refusal, not a
 * skipped gate.
 */
import { PG_MIGRATIONS } from '../src/db/pg-migrations.ts';
import { MigrationLedger, defineMigration } from '../src/generated/storage-kit/migrations.ts';
import { createServerPoolFromEnv } from '../src/generated/storage-kit/pool.ts';
import { PostgresV1Store } from '../src/server/v1-store.ts';
import { apiKeyMigrations } from '@hasna/contracts/auth';

const testUrl = process.env.HASNA_PROMPTS_PG_TEST_DATABASE_URL?.trim();
if (!testUrl) {
  console.error('storage:pg-test requires HASNA_PROMPTS_PG_TEST_DATABASE_URL (a disposable test database).');
  process.exit(2);
}
process.env.HASNA_PROMPTS_DATABASE_URL = testUrl;

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
  await ledger.migrate({ dryRun: false });

  const store = new PostgresV1Store(client);
  const created = await store.create({
    title: 'pg-test smoke',
    body: 'smoke body',
    slug: `pg-test-smoke-${Date.now()}`,
  }, null);
  const fetched = await store.get(created.id, null);
  if (!fetched || fetched.body !== 'smoke body') {
    throw new Error('pg-test smoke: create/get round-trip failed');
  }
  await store.remove(created.id, null);
  const count = await store.status();
  console.log(JSON.stringify({ ok: true, backend: 'postgresql', prompts_total: count.prompts_total }, null, 2));
} finally {
  await client.close();
}
