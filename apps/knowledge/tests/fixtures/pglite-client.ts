/**
 * Shared in-process Postgres harness for the tests that must exercise REAL
 * Postgres semantics — triggers, generated columns, `IS NOT DISTINCT FROM`,
 * transaction-local GUCs — rather than a SQL-string-matching fake.
 *
 * There was already one of these inlined in search-pg-parity.test.ts, missing
 * `transaction()`. A second copy that silently lacks a method the code under
 * test now calls is the same two-implementations-drift-apart failure the
 * versioning trigger exists to prevent, so that file now imports this one
 * instead of keeping its own — the claim "one shim" is only worth making if the
 * duplicate is actually gone.
 */
import { PGlite } from '@electric-sql/pglite';
import { buildKnowledgePostgresMigrations } from '../../src/db/migrate-list';
import {
  MigrationLedger,
  type Migration,
  type PoolQueryClient,
} from '../../src/generated/storage-kit/index.js';

/**
 * Wrap a PGlite instance in the `PoolQueryClient` vocabulary the serve layer
 * uses. `transaction()` is real BEGIN/COMMIT: PGlite is a single connection, so
 * a transaction-local `set_config(..., true)` behaves exactly as it does on a
 * pooled client checked out for the duration of the call.
 */
export function pgliteClient(db: PGlite): PoolQueryClient {
  const exec = async <T>(sql: string, params: readonly unknown[] = []) =>
    db.query<T>(sql, params as unknown[]);

  const base = {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const result = await exec<T>(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
    async many<T>(sql: string, params: readonly unknown[] = []) {
      return (await exec<T>(sql, params)).rows;
    },
    async get<T>(sql: string, params: readonly unknown[] = []) {
      return (await exec<T>(sql, params)).rows[0] ?? null;
    },
    async one<T>(sql: string, params: readonly unknown[] = []) {
      const row = (await exec<T>(sql, params)).rows[0];
      if (!row) throw new Error('no rows');
      return row;
    },
    async execute(sql: string, params: readonly unknown[] = []) {
      // With no parameters, use the simple query protocol (db.exec) exactly
      // like node-postgres does: the extended protocol rejects multi-statement
      // SQL, and the real migrate program contains multi-statement migrations
      // (the api-keys index pair), so a harness that cannot run them is not
      // the harness the ledger tests may stand on.
      if (params.length === 0) {
        await db.exec(sql);
        return;
      }
      await exec(sql, params);
    },
  };

  return {
    ...base,
    async transaction<T>(fn: (client: typeof base) => Promise<T>): Promise<T> {
      await db.query('BEGIN');
      try {
        const result = await fn(base);
        await db.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await db.query('ROLLBACK');
        } catch {
          // surface the original error
        }
        throw error;
      }
    },
    async close() {},
    get pool() {
      return {} as never;
    },
  } as unknown as PoolQueryClient;
}

/**
 * Apply the real deploy schema, in the same order and with the same pieces as
 * `scripts/apply-postgres-migrations.mjs`: the single migration program
 * composed by buildKnowledgePostgresMigrations (pgcrypto extension, every
 * knowledge_pg_* statement, the project-links statements, the api-keys ledger
 * the serve auth middleware reads, and the rc.6 tenancy program).
 *
 * Using the same builder as the migrate script (rather than a subset whose
 * text mentions a table of interest) is deliberate. MEASURED against the
 * current array: a `.includes('knowledge_items')` filter keeps 11 of 75
 * statements and DOES keep the entry trigger and the versions table — but
 * drops the append-only guard and both secondary indexes, because
 * `'knowledge_item_versions'` does not contain `'knowledge_items'` as a
 * substring. A filter that silently produces a schema production never has is
 * not a base any assertion below should stand on.
 */
export async function applyKnowledgePgMigrations(db: PGlite): Promise<void> {
  // Production creates this before the table DDL. PGlite has gen_random_uuid in
  // core, so a build without the contrib module must not fail the harness.
  await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto').catch(() => {});
  for (const migration of buildKnowledgePostgresMigrations()) {
    if (migration.id === 'knowledge_pg_000_extensions') continue;
    await db.exec(migration.sql);
  }
}

export async function applyKnowledgePgMigrationsThroughLedger(
  client: PoolQueryClient,
  migrations: readonly Migration[] = buildKnowledgePostgresMigrations(),
) {
  // PGlite has gen_random_uuid in core; the pgcrypto extension is not available
  // in the in-process build, so the extension migration is skipped exactly like
  // the direct path does above.
  const ledger = new MigrationLedger(
    client,
    migrations.filter((migration) => migration.id !== 'knowledge_pg_000_extensions'),
  );
  return ledger.migrate();
}

async function createHostedUuidTenantKnowledgeItemsSchema(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE knowledge_items (
      id TEXT PRIMARY KEY,
      short_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      url TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL DEFAULT NOW()::text,
      updated_at TEXT NOT NULL DEFAULT NOW()::text,
      tenant_id UUID
    )
  `);
}

/** A migrated, empty in-process Postgres plus its `PoolQueryClient`. */
export async function createMigratedPglite(options: {
  knowledgeItemsTenantIdType?: 'text' | 'uuid';
  migrationMode?: 'direct' | 'existing-ledger-upgrade' | 'pre-adoption-ledger-upgrade';
} = {}): Promise<{ db: PGlite; client: PoolQueryClient }> {
  const db = new PGlite();
  if (options.knowledgeItemsTenantIdType === 'uuid') {
    await createHostedUuidTenantKnowledgeItemsSchema(db);
  }
  const client = pgliteClient(db);
  if (options.migrationMode === 'existing-ledger-upgrade') {
    const full = buildKnowledgePostgresMigrations();
    await applyKnowledgePgMigrationsThroughLedger(client, full.slice(0, -1));
    await applyKnowledgePgMigrationsThroughLedger(client, full);
  } else if (options.migrationMode === 'pre-adoption-ledger-upgrade') {
    const full = buildKnowledgePostgresMigrations();
    const adoptionBoundary = full.findIndex((migration) =>
      migration.sql.includes('ADD COLUMN IF NOT EXISTS guarded_adoption_receipt_id'));
    if (adoptionBoundary < 1) {
      throw new Error('test fixture could not locate the guarded-adoption migration boundary.');
    }
    await applyKnowledgePgMigrationsThroughLedger(client, full.slice(0, adoptionBoundary));
    await applyKnowledgePgMigrationsThroughLedger(client, full);
  } else {
    await applyKnowledgePgMigrations(db);
  }
  return { db, client };
}
