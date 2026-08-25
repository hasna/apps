/**
 * Legacy-ledger compatibility for the Postgres migrate tool (O15-00684).
 *
 * HISTORY — why this test exists at all:
 *
 * The prod knowledge DB (knowledge-prod, oss-fleet-prod ECS) was migrated on
 * 2026-08-11 by the PRE-monorepo image @hasnaxyz/knowledge 1.0.0-rc.6, whose
 * `apply-cloud-migrations.mjs` wrote ledger rows under a DIFFERENT id scheme
 * than the current build:
 *
 *   - knowledge_pg_001..129   (the rc.6 schema program — the current array has
 *                              drifted: search-stage-2 statements were inserted
 *                              mid-array and three guarded-receipt FK/unique
 *                              statements were dropped, so ids 64+ no longer
 *                              name the same SQL),
 *   - knowledge_project_links_001..008  (project-links statements, which the
 *                              current build folded into the index-derived
 *                              knowledge_pg_* numbering),
 *   - knowledge_tenancy_001..062 (the rc.6 tenancy program, which the current
 *                              build does not define at all),
 *   - hasna_auth_0001..0003_api_keys  (unchanged, still byte-identical).
 *
 * The MigrationLedger downgrade guard then refused every deploy with:
 *   Applied migration 'knowledge_project_links_001' is not recognized by this
 *   build (downgrade?).
 *
 * The fix restores the id scheme the prod ledger was written under:
 *   - pg-migrations.ts is re-ordered so knowledge_pg_001..129 name exactly the
 *     rc.6 statements (the three guarded-receipt statements are restored at
 *     their historical positions; the search-stage-2 block moves to the END of
 *     the array as knowledge_pg_130..131),
 *   - the project-links statements get their own named ids
 *     knowledge_project_links_001..008 (same SQL, so checksums match),
 *   - the rc.6 tenancy program is defined under knowledge_tenancy_001..062.
 *
 * THE FIXTURE: tests/fixtures/legacy-ledger-checksums.json pins the checksum of
 * every ledger row the rc.6 migrate wrote to prod, measured from the deployed
 * image's compiled bundles (sha256 of the trimmed SQL, the same checksumSql the
 * storage kit uses). Any future in-place edit of a statement under ids 1..129,
 * the project-links statements, or the tenancy program fails this test with the
 * SAME error the prod ledger guard produces — the append-only discipline, made
 * mechanical.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { buildKnowledgePostgresMigrations } from '../src/serve';
import { MigrationLedger } from '../src/generated/storage-kit/migrations.js';
import { pgliteClient } from './fixtures/pglite-client';

const PINNED: Record<string, string> = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'legacy-ledger-checksums.json'), 'utf8'),
);

function buildLedgerRows(ids: string[]): { id: string; checksum: string }[] {
  return ids.map((id) => ({ id, checksum: PINNED[id] }));
}

test('migration list defines every prod-ledger legacy id with the exact pinned checksum', () => {
  const migrations = buildKnowledgePostgresMigrations();
  const byId = new Map(migrations.map((m) => [m.id, m.checksum]));

  // No duplicate ids (the ledger constructor refuses duplicates anyway).
  expect(byId.size).toBe(migrations.length);

  const pinnedIds = Object.keys(PINNED);
  expect(pinnedIds.length).toBe(203);
  for (const id of pinnedIds) {
    expect(byId.has(id), `legacy ledger id ${id} must be defined by this build`).toBe(true);
    expect(byId.get(id), `checksum for ${id} must match the applied prod migration`).toBe(PINNED[id]);
  }
});

test('the full prod ledger is recognized; only the search stage-2 pair is pending', async () => {
  const db = new PGlite();
  const client = pgliteClient(db);
  const migrations = buildKnowledgePostgresMigrations();

  // Fabricate the prod ledger exactly as the rc.6 migrate left it: every row
  // the pinned fixture names, with the pinned checksum.
  await client.execute(
    'CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
  );
  for (const id of Object.keys(PINNED)) {
    await client.execute(
      'INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)',
      [id, PINNED[id]],
    );
  }

  const ledger = new MigrationLedger(client, migrations);
  const result = await ledger.migrate({ dryRun: true });

  const pending = result.plan.filter((item) => item.state === 'pending').map((item) => item.migration.id);
  expect(pending).toEqual(['knowledge_pg_130', 'knowledge_pg_131']);
  expect(result.plan.length - pending.length).toBe(migrations.length - 2);
});

test('the downgrade guard still refuses a genuinely unknown ledger row', async () => {
  const db = new PGlite();
  const client = pgliteClient(db);
  const migrations = buildKnowledgePostgresMigrations();

  await client.execute(
    'CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
  );
  await client.execute('INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)', [
    'knowledge_pg_999_unknown',
    'sha256:deadbeef',
  ]);

  const ledger = new MigrationLedger(client, migrations);
  await expect(ledger.migrate({ dryRun: true })).rejects.toThrow(/not recognized by this build/);
});
