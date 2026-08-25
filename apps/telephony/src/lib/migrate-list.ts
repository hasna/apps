/**
 * The single ordered Postgres migration program for @hasna/telephony
 * (O15-00691).
 *
 * One builder, two consumers: scripts/apply-cloud-migrations.mjs (the
 * deploy-time migrate step) and tests/legacy-ledger-compat.test.ts. A second
 * composition elsewhere is the drift this module exists to prevent — the prod
 * ledger guard fails exactly when the composed list stops matching what the
 * fleet's database was migrated under.
 *
 * The id scheme is the rc.1 scheme (deployed 2026-07-13), restored after the
 * monorepo import dropped the R1 tenancy program from it:
 *
 *   telephony_pg_000_extensions
 *   telephony_pg_001..N      the current schema program (pg-migrations.ts;
 *                            N=1 today — ids 002..003 are the rc.1 tenancy
 *                            program, defined by legacy-migrations.ts)
 *   hasna_auth_0001..0003_*  from @hasna/contracts/auth (unchanged)
 *   telephony_api_keys_tenancy_001  the rc.1 api-keys bridge
 *                            (legacy-migrations.ts)
 *
 * APPEND-ONLY: ids are derived from array position or pinned by
 * tests/fixtures/legacy-ledger-checksums.json. Do not insert mid-array and do
 * not edit a pinned statement in place.
 */
import { apiKeyMigrations } from '@hasna/contracts/auth';
import { defineMigration, type Migration } from '../generated/storage-kit/migrations.js';
import { PG_MIGRATIONS } from './pg-migrations.js';
import {
  API_KEYS_TENANCY_BRIDGE_SQL,
  LEGACY_TENANCY_AUTHORITY_MIGRATIONS,
  LEGACY_TENANT_COLUMNS_MIGRATIONS,
} from './legacy-migrations.js';

export function buildTelephonyPostgresMigrations(): Migration[] {
  return [
    defineMigration('telephony_pg_000_extensions', 'CREATE EXTENSION IF NOT EXISTS pgcrypto'),
    ...PG_MIGRATIONS.map((sql, index) =>
      defineMigration(`telephony_pg_${String(index + 1).padStart(3, '0')}`, sql),
    ),
    ...LEGACY_TENANCY_AUTHORITY_MIGRATIONS.map((sql, index) =>
      defineMigration(`telephony_pg_${String(index + 2).padStart(3, '0')}`, sql),
    ),
    ...LEGACY_TENANT_COLUMNS_MIGRATIONS.map((sql, index) =>
      defineMigration(`telephony_pg_${String(index + 3).padStart(3, '0')}`, sql),
    ),
    ...apiKeyMigrations().map((m) => defineMigration(m.id, m.sql)),
    defineMigration('telephony_api_keys_tenancy_001', API_KEYS_TENANCY_BRIDGE_SQL),
  ];
}
