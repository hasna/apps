// Regression tests for the notes PostgreSQL migration set (server/pg-migrations.ts).
//
// Runs the real migration list through the vendored storage kit's
// MigrationLedger (sha256 checksums, drift guard, dry-run) against an
// in-process Postgres (pglite), so the SQL is exercised — not just asserted
// by shape. Key properties under test:
//   - the full schema translates (tenants/users/sessions/api_keys/
//     otp_login_requests/device_auth_requests/notes/note_events/seq_counters),
//   - sync_batches is DROPPED in the new backend (sync is being removed
//     fleet-wide; the SQLite schema keeps it until the removal lane lands),
//   - api_keys comes from @hasna/contracts/auth (contracts table shape),
//   - the ledger records sha256 checksums and refuses drift,
//   - dry-run plans without mutating.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { MigrationLedger, defineMigration } from '../src/generated/storage-kit/index.js';
import { notesPgMigrations } from '../server/pg-migrations.ts';

let db;
let client;

beforeAll(async () => {
  // The pgcrypto contrib extension matches production PostgreSQL, where the
  // notes_pg_000_extensions migration runs CREATE EXTENSION IF NOT EXISTS pgcrypto.
  db = new PGlite({ extensions: { pgcrypto } });
  client = pgliteClient(db);
});

afterAll(async () => {
  await db.close();
});

function pgliteClient(pglite) {
  const exec = async (sql, params = []) => pglite.query(sql, params);
  const base = {
    async query(sql, params = []) {
      const result = await exec(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
    async many(sql, params = []) {
      return (await exec(sql, params)).rows;
    },
    async get(sql, params = []) {
      return (await exec(sql, params)).rows[0] ?? null;
    },
    async one(sql, params = []) {
      const row = (await exec(sql, params)).rows[0];
      if (!row) throw new Error('no rows');
      return row;
    },
    async execute(sql, params = []) {
      // Multi-statement migrations (e.g. CREATE TABLE + CREATE INDEX in one
      // migration) run through pglite.exec — pglite.query rejects them.
      if (params.length === 0) await pglite.exec(sql);
      else await exec(sql, params);
    },
  };
  return base;
}

describe('notes PostgreSQL migration set', () => {
  test('migration ids are unique and namespaced', () => {
    const migrations = notesPgMigrations();
    const ids = migrations.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    // notes schema migrations carry notes_pg_ ids; the contracts api-keys
    // ledger keeps its own hasna_auth_ ids (knowledge pattern — namespaced so
    // they never clash with the app schema ids).
    for (const id of ids) expect(id).toMatch(/^(notes_pg_|hasna_auth_)/);
  });

  test('dry-run applies nothing and reports a plan', async () => {
    const ledger = new MigrationLedger(client, notesPgMigrations());
    const result = await ledger.migrate({ dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.applied.length).toBe(0);
    expect(result.plan.every((item) => item.state === 'pending')).toBe(true);
    const tables = await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    expect(tables.rows.map((r) => r.tablename)).not.toContain('notes');
  });

  test('full apply creates the schema, drops sync_batches, keeps note_events', async () => {
    const ledger = new MigrationLedger(client, notesPgMigrations());
    const result = await ledger.migrate();
    expect(result.dryRun).toBe(false);
    expect(result.applied.length).toBe(notesPgMigrations().length);
    const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))
      .rows.map((r) => r.tablename);
    for (const expected of [
      'tenants', 'users', 'sessions', 'api_keys', 'otp_login_requests',
      'device_auth_requests', 'notes', 'note_events', 'seq_counters', 'schema_migrations',
    ]) {
      expect(tables).toContain(expected);
    }
    expect(tables).not.toContain('sync_batches');
  });

  test('api_keys table carries the contracts auth shape', async () => {
    const columns = (await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'api_keys'",
    )).rows.map((r) => r.column_name);
    for (const expected of ['kid', 'app', 'token_hash', 'scopes', 'revoked_at', 'issued_at']) {
      expect(columns).toContain(expected);
    }
  });

  test('ledger records sha256 checksums', async () => {
    const rows = (await db.query(
      'SELECT id, checksum FROM schema_migrations ORDER BY id ASC',
    )).rows;
    expect(rows.length).toBe(notesPgMigrations().length);
    for (const row of rows) expect(row.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('re-running is idempotent (all already applied)', async () => {
    const ledger = new MigrationLedger(client, notesPgMigrations());
    const result = await ledger.migrate();
    // `applied` is the full applied set after the run; the plan's states are
    // the idempotency signal — nothing may be re-executed.
    expect(result.plan.every((item) => item.state === 'already_applied')).toBe(true);
    expect(result.applied.length).toBe(notesPgMigrations().length);
  });

  test('changed migration SQL after apply refuses to proceed (drift guard)', async () => {
    const drifted = notesPgMigrations().map((m, i) =>
      i === 0 ? defineMigration(m.id, `${m.sql} -- drifted`) : m,
    );
    const ledger = new MigrationLedger(client, drifted);
    expect(ledger.migrate()).rejects.toThrow(/checksum|drift/i);
  });

  test('unknown applied migration refuses (downgrade guard)', async () => {
    const extra = new MigrationLedger(client, [
      ...notesPgMigrations(),
      defineMigration('notes_pg_999_ghost', 'CREATE TABLE ghost (id TEXT PRIMARY KEY)'),
    ]);
    await extra.migrate();
    const ledger = new MigrationLedger(client, notesPgMigrations());
    expect(ledger.migrate()).rejects.toThrow(/unknown|downgrade|unexpected/i);
  });
});
