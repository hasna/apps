/**
 * The single ordered Postgres migration program for @hasna/knowledge
 * (O15-00684).
 *
 * One builder, two consumers: scripts/apply-postgres-migrations.mjs (the
 * deploy-time migrate step) and tests/legacy-ledger-compat.test.ts. A second
 * composition elsewhere is the drift this module exists to prevent — the prod
 * ledger guard fails exactly when the composed list stops matching what the
 * fleet's databases were migrated under.
 *
 * The id scheme is the rc.6 scheme (deployed 2026-08-11), restored after the
 * monorepo import drifted from it:
 *
 *   knowledge_pg_000_extensions
 *   knowledge_pg_001..129      the rc.6 schema program (pg-migrations.ts is
 *                              ordered byte-identically; ids 130..131 are the
 *                              search stage-2 pair appended later)
 *   knowledge_project_links_001..008
 *   hasna_auth_0001..0003_*    from @hasna/contracts/auth (unchanged)
 *   knowledge_tenancy_001..062 the rc.6 tenancy program (legacy-migrations.ts)
 *
 * APPEND-ONLY: ids are derived from array position or pinned by
 * tests/fixtures/legacy-ledger-checksums.json. Do not insert mid-array and do
 * not edit a pinned statement in place.
 */
import { apiKeyMigrations } from '@hasna/contracts/auth';
import { postgresKnowledgeProjectLinksSchemaStatements } from '../project-links.js';
import { defineMigration, type Migration } from '../generated/storage-kit/migrations.js';
import { PG_MIGRATIONS } from './pg-migrations.js';
import { LEGACY_TENANCY_MIGRATIONS } from './legacy-migrations.js';

export function buildKnowledgePostgresMigrations(): Migration[] {
  return [
    defineMigration('knowledge_pg_000_extensions', 'CREATE EXTENSION IF NOT EXISTS pgcrypto'),
    ...PG_MIGRATIONS.map((sql, index) =>
      defineMigration(`knowledge_pg_${String(index + 1).padStart(3, '0')}`, sql),
    ),
    ...postgresKnowledgeProjectLinksSchemaStatements().map((sql, index) =>
      defineMigration(`knowledge_project_links_${String(index + 1).padStart(3, '0')}`, sql),
    ),
    ...apiKeyMigrations().map((m) => defineMigration(m.id, m.sql)),
    ...LEGACY_TENANCY_MIGRATIONS.map((sql, index) =>
      defineMigration(`knowledge_tenancy_${String(index + 1).padStart(3, '0')}`, sql),
    ),
  ];
}
