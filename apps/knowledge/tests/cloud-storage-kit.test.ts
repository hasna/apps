import { describe, expect, test } from 'bun:test';
import {
  KIT_VERSION,
  assertNoLegacyStorageMode,
  defineMigration,
  MigrationLedger,
  resolveServerDataBackend,
  resolveTlsConfig,
  serverDataBackendEnvKeys,
  wrapExecutor,
  type PgExecutor,
  type TypedQueryClient,
} from '../src/generated/storage-kit';
import { createKnowledgeDatabaseClient } from '../src/db/remote-storage';

class FakeExecutor implements PgExecutor {
  constructor(private readonly rows: Record<string, unknown>[]) {}
  async query<T>(_sql: string, _params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
    return { rows: this.rows as unknown as T[], rowCount: this.rows.length };
  }
}

class FakeMigrationClient implements TypedQueryClient {
  readonly executed: string[] = [];
  transactionCount = 0;

  async query<T>(): Promise<{ rows: T[]; rowCount: number }> {
    return { rows: [], rowCount: 0 };
  }

  async many<T>(): Promise<T[]> {
    return [];
  }

  async get<T>(): Promise<T | null> {
    return null;
  }

  async one<T>(): Promise<T> {
    throw new Error('No rows');
  }

  async execute(sql: string): Promise<void> {
    this.executed.push(sql);
  }

  async transaction<T>(fn: (client: TypedQueryClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    this.executed.push('BEGIN');
    try {
      const result = await fn(this);
      this.executed.push('COMMIT');
      return result;
    } catch (error) {
      this.executed.push('ROLLBACK');
      throw error;
    }
  }
}

describe('vendored server storage kit surface', () => {
  test('exposes a stamped kit version', () => {
    expect(KIT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('restores the single-row get() helper', async () => {
    const populated = wrapExecutor(new FakeExecutor([{ id: 'a' }, { id: 'b' }]));
    expect(await populated.get<{ id: string }>('SELECT ...')).toEqual({ id: 'a' });

    const empty = wrapExecutor(new FakeExecutor([]));
    expect(await empty.get('SELECT ...')).toBeNull();
  });

  test('one() enforces exactly-one-row semantics', async () => {
    const single = wrapExecutor(new FakeExecutor([{ id: 'only' }]));
    expect(await single.one<{ id: string }>('SELECT ...')).toEqual({ id: 'only' });
    const empty = wrapExecutor(new FakeExecutor([]));
    await expect(empty.one('SELECT ...')).rejects.toThrow('exactly one row');
  });

  test('resolves the canonical server database URL contract', () => {
    const keys = serverDataBackendEnvKeys('knowledge');
    expect(keys.databaseUrlKeys[0]).toBe('HASNA_KNOWLEDGE_DATABASE_URL');
    expect(resolveServerDataBackend('knowledge', {}).backend).toBe('sqlite');
    expect(resolveServerDataBackend('knowledge', {
      HASNA_KNOWLEDGE_DATABASE_URL: 'postgres://x/y',
    }).backend).toBe('postgresql');
  });

  test('maps sslmode according to the generated TLS contract', () => {
    const env = {};
    expect(resolveTlsConfig('postgres://user:pass@example.test/db', { env })).toBeUndefined();
    expect(resolveTlsConfig('postgres://user:pass@example.test/db?sslmode=disable', { env })).toBe(false);
    expect(resolveTlsConfig('postgres://user:pass@example.test/db?sslmode=prefer', { env })).toEqual({
      rejectUnauthorized: true,
    });
    expect(resolveTlsConfig('postgres://user:pass@example.test/db?sslmode=allow', { env })).toEqual({
      rejectUnauthorized: true,
    });
    expect(resolveTlsConfig('postgres://user:pass@example.test/db?sslmode=require', { env })).toEqual({
      rejectUnauthorized: true,
    });
    expect(() => resolveTlsConfig('postgres://user:pass@example.test/db?sslmode=verify-full', { env })).toThrow(
      'requires a CA bundle',
    );
  });

  test('applies migration SQL and ledger writes through the generated ledger', async () => {
    const client = new FakeMigrationClient();
    const ledger = new MigrationLedger(client, [
      defineMigration('001_init', 'CREATE TABLE example (id TEXT PRIMARY KEY)'),
    ]);

    await ledger.migrate();

    expect(client.transactionCount).toBe(0);
    expect(client.executed).toEqual([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      'CREATE TABLE example (id TEXT PRIMARY KEY)',
      expect.stringContaining('INSERT INTO schema_migrations'),
    ]);
  });

  test('retired server selector is a fail-loud ratchet', () => {
    expect(() => assertNoLegacyStorageMode('knowledge', {
      HASNA_KNOWLEDGE_STORAGE_MODE: '',
    })).toThrow(/HASNA_KNOWLEDGE_STORAGE_MODE.*HASNA_KNOWLEDGE_DATABASE_URL/s);
  });

  test('createKnowledgeDatabaseClient requires only the canonical database URL', () => {
    const client = createKnowledgeDatabaseClient({
      HASNA_KNOWLEDGE_DATABASE_URL: 'postgres://user:redacted@example.test/db?sslmode=disable',
    });
    expect(client).toBeDefined();
    expect(() => createKnowledgeDatabaseClient({})).toThrow(/HASNA_KNOWLEDGE_DATABASE_URL/);
  });
});
