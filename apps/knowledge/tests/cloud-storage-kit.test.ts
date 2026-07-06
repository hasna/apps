import { describe, expect, test } from 'bun:test';
import {
  KIT_VERSION,
  createKnowledgeCloudClient,
  defineMigration,
  normalizeCloudStorageMode,
  MigrationLedger,
  resolveTlsConfig,
  resolveStorageMode,
  storageEnvKeys,
  wrapExecutor,
  type TypedQueryClient,
  type PgExecutor,
} from '../src/storage';

/**
 * A tiny in-memory executor shim so the kit's typed query surface can be
 * exercised without a live Postgres. Mirrors the shape pg.Pool returns.
 */
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

describe('vendored cloud storage kit surface', () => {
  test('exposes a stamped kit version', () => {
    expect(KIT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('restores the dropped single-row get() helper', async () => {
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

  test('resolves the canonical HASNA_KNOWLEDGE_* env contract', () => {
    const keys = storageEnvKeys('knowledge');
    expect(keys.modeKeys[0]).toBe('HASNA_KNOWLEDGE_STORAGE_MODE');
    expect(keys.databaseUrlKeys[0]).toBe('HASNA_KNOWLEDGE_DATABASE_URL');

    expect(resolveStorageMode('knowledge', {}).mode).toBe('local');
    expect(
      resolveStorageMode('knowledge', {
        HASNA_KNOWLEDGE_STORAGE_MODE: 'cloud',
        HASNA_KNOWLEDGE_DATABASE_URL: 'postgres://x/y',
      }).mode,
    ).toBe('cloud');
  });

  test('maps sslmode prefer and allow to encrypted pg connections', () => {
    const env = {};
    expect(resolveTlsConfig('postgres://user:pass@example.test/db', { env })).toBeUndefined();
    expect(resolveTlsConfig('postgres://user:pass@example.test/db?sslmode=disable', { env })).toBeUndefined();
    expect(resolveTlsConfig('postgres://user:pass@example.test/db?sslmode=prefer', { env })).toEqual({
      rejectUnauthorized: false,
    });
    expect(resolveTlsConfig('postgres://user:pass@example.test/db?sslmode=allow', { env })).toEqual({
      rejectUnauthorized: false,
    });
    expect(resolveTlsConfig('postgres://user:pass@example.test/db?sslmode=require', { env })).toEqual({
      rejectUnauthorized: false,
    });
    expect(() => resolveTlsConfig('postgres://user:pass@example.test/db?sslmode=verify-full', { env })).toThrow(
      'requires a CA bundle',
    );
  });

  test('applies migration SQL and ledger writes in one transaction', async () => {
    const client = new FakeMigrationClient();
    const ledger = new MigrationLedger(client, [
      defineMigration('001_init', 'CREATE TABLE example (id TEXT PRIMARY KEY)'),
    ]);

    await ledger.migrate();

    expect(client.transactionCount).toBe(1);
    expect(client.executed).toEqual([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      'BEGIN',
      'CREATE TABLE example (id TEXT PRIMARY KEY)',
      expect.stringContaining('INSERT INTO schema_migrations'),
      'COMMIT',
    ]);
  });

  test('normalizes deprecated aliases to cloud', () => {
    expect(normalizeCloudStorageMode('remote').mode).toBe('cloud');
    expect(normalizeCloudStorageMode('hybrid').mode).toBe('cloud');
    expect(normalizeCloudStorageMode('self_hosted').mode).toBe('cloud');
    expect(normalizeCloudStorageMode('local').mode).toBe('local');
  });

  test('createKnowledgeCloudClient refuses non-cloud mode without leaking the URL', () => {
    const priorMode = process.env.HASNA_KNOWLEDGE_STORAGE_MODE;
    const priorUrl = process.env.HASNA_KNOWLEDGE_DATABASE_URL;
    try {
      delete process.env.HASNA_KNOWLEDGE_STORAGE_MODE;
      process.env.HASNA_KNOWLEDGE_DATABASE_URL = 'postgres://secret:secret@host/db';
      expect(() => createKnowledgeCloudClient()).toThrow(/storage mode 'cloud'/);
      try {
        createKnowledgeCloudClient();
      } catch (error) {
        expect(String(error)).not.toContain('secret');
      }
    } finally {
      if (priorMode === undefined) delete process.env.HASNA_KNOWLEDGE_STORAGE_MODE;
      else process.env.HASNA_KNOWLEDGE_STORAGE_MODE = priorMode;
      if (priorUrl === undefined) delete process.env.HASNA_KNOWLEDGE_DATABASE_URL;
      else process.env.HASNA_KNOWLEDGE_DATABASE_URL = priorUrl;
    }
  });
});
