/**
 * Legacy-ledger compatibility for the Postgres migrate tool (O15-00691).
 *
 * HISTORY — why this test exists at all:
 *
 * The prod telephony DB (telephony-prod, oss-fleet-prod ECS) was migrated on
 * 2026-07-13 by the PRE-monorepo image @hasnaxyz/telephony 1.0.0-rc.1 (ECR
 * prod-20260713-183838-r1rc1, sha256:90af5911...), whose
 * `apply-cloud-migrations.mjs` wrote ledger rows under an id scheme the
 * current build no longer composes:
 *
 *   - telephony_pg_000_extensions,
 *   - telephony_pg_001..003    (the rc.1 schema program — the current
 *                               pg-migrations.ts array kept only 001; ids
 *                               002..003 are the R1 tenancy program, dropped
 *                               from the OSS tree after the monorepo import),
 *   - hasna_auth_0001..0002_api_keys  (from @hasna/contracts/auth 0.4.2 —
 *                               unchanged and still byte-identical),
 *   - telephony_api_keys_tenancy_001 (the rc.1 api-keys tenancy bridge,
 *                               not defined by the current build at all).
 *
 * The MigrationLedger downgrade guard then refused every deploy with:
 *   Applied migration telephony_api_keys_tenancy_001 is not recognized by
 *   this build (downgrade?).
 * (The guard reports the FIRST unknown row in id order, so telephony_pg_002
 * and telephony_pg_003 sit behind the named one.)
 *
 * The fix restores the id scheme the prod ledger was written under:
 *   - legacy-migrations.ts defines the rc.1 tenancy program byte-exactly
 *     under telephony_pg_002..003 plus the api-keys bridge under
 *     telephony_api_keys_tenancy_001,
 *   - migrate-list.ts composes ONE program (extensions -> telephony_pg_* ->
 *     hasna_auth_* -> bridge) used by both the migrate script and this test.
 *
 * THE FIXTURE: tests/fixtures/legacy-ledger-checksums.json pins the checksum
 * of every ledger row the rc.1 migrate wrote to prod, measured from the
 * deployed image's compiled bundles (sha256 of the trimmed SQL — the same
 * checksumSql the storage kit uses, so the pinned values are the ledger's
 * stored checksums by construction). Any future in-place edit of a statement
 * under a pinned id fails this test with the SAME error the prod ledger guard
 * produces — the append-only discipline, made mechanical.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTelephonyPostgresMigrations } from '../src/lib/migrate-list.js';
import { MigrationLedger } from '../src/generated/storage-kit/migrations.js';
import type { TypedQueryClient } from '../src/generated/storage-kit/query.js';

const PINNED: Record<string, string> = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'legacy-ledger-checksums.json'), 'utf8'),
);

/** In-memory TypedQueryClient answering the ledger reads the runner makes. */
function fakeClient(rows: { id: string; checksum: string }[]): TypedQueryClient {
  return {
    async query<T extends { id: string; checksum: string }>(sql: string) {
      if (sql.includes('FROM schema_migrations')) {
        return { rows: rows as T[], rowCount: rows.length };
      }
      return { rows: [] as T[], rowCount: 0 };
    },
    async many<T extends { id: string; checksum: string }>() {
      return rows as T[];
    },
    async get<T extends { id: string; checksum: string }>() {
      return (rows[0] ?? null) as T | null;
    },
    async one<T extends { id: string; checksum: string }>() {
      if (rows.length !== 1) throw new Error('expected exactly one row');
      return rows[0] as T;
    },
    async execute() {},
  };
}

function ledgerRows(ids: string[]): { id: string; checksum: string }[] {
  // Mirror the prod read: readApplied() orders by id ASC, and the downgrade
  // guard reports the first unknown in that order.
  return [...ids].sort().map((id) => ({ id, checksum: PINNED[id] }));
}

test('migration list defines every prod-ledger id with the exact pinned checksum', () => {
  const migrations = buildTelephonyPostgresMigrations();
  const byId = new Map(migrations.map((m) => [m.id, m.checksum]));

  // No duplicate ids (the ledger constructor refuses duplicates anyway).
  expect(byId.size).toBe(migrations.length);

  const pinnedIds = Object.keys(PINNED);
  expect(pinnedIds.length).toBe(7);
  for (const id of pinnedIds) {
    expect(byId.has(id), `legacy ledger id ${id} must be defined by this build`).toBe(true);
    expect(byId.get(id), `checksum for ${id} must match the applied prod migration`).toBe(PINNED[id]);
  }
});

test('the full prod ledger is recognized; only hasna_auth_0003 is pending', async () => {
  const client = fakeClient(ledgerRows(Object.keys(PINNED)));
  const migrations = buildTelephonyPostgresMigrations();

  const ledger = new MigrationLedger(client, migrations);
  const result = await ledger.migrate({ dryRun: true });

  const pending = result.plan.filter((item) => item.state === 'pending').map((item) => item.migration.id);
  // The rc.1 image shipped contracts 0.4.2 (auth rows 0001..0002); the current
  // contracts adds hasna_auth_0003_api_keys_tenant, which is the only row not
  // yet applied on prod — additive and safe to run.
  expect(pending).toEqual(['hasna_auth_0003_api_keys_tenant']);
  expect(result.plan.length - pending.length).toBe(migrations.length - 1);
});

test('the downgrade guard still refuses a genuinely unknown ledger row', async () => {
  const client = fakeClient([{ id: 'telephony_pg_999_unknown', checksum: 'sha256:deadbeef' }]);
  const migrations = buildTelephonyPostgresMigrations();

  const ledger = new MigrationLedger(client, migrations);
  await expect(ledger.migrate({ dryRun: true })).rejects.toThrow(/not recognized by this build/);
});

test('the checksum guard still refuses a drifted pinned statement', async () => {
  // A pinned id whose stored checksum no longer matches the program's — the
  // shape an in-place edit of legacy-migrations.ts would produce.
  const tampered = ledgerRows(Object.keys(PINNED)).map((row) =>
    row.id === 'telephony_pg_002'
      ? { ...row, checksum: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' }
      : row,
  );
  const client = fakeClient(tampered);
  const migrations = buildTelephonyPostgresMigrations();

  const ledger = new MigrationLedger(client, migrations);
  await expect(ledger.migrate({ dryRun: true })).rejects.toThrow(/checksum mismatch/);
});
