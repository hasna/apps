import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KNOWLEDGE_STORAGE_ENV,
  KNOWLEDGE_STORAGE_FALLBACK_ENV,
  KNOWLEDGE_STORAGE_MODE_ENV,
  KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV,
  STORAGE_TABLES,
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
  parseStorageTables,
  resolveTables,
} from '../src/storage';

const ENV_KEYS = [
  KNOWLEDGE_STORAGE_ENV,
  KNOWLEDGE_STORAGE_FALLBACK_ENV,
  KNOWLEDGE_STORAGE_MODE_ENV,
  KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV,
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('knowledge database storage sync config', () => {
  test('resolves canonical database env, fallback env, and storage mode', () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(getStorageDatabaseEnv()).toBeNull();
    expect(getStorageDatabaseUrl()).toBeNull();
    expect(getStorageMode()).toBe('local');

    process.env[KNOWLEDGE_STORAGE_FALLBACK_ENV] = 'postgres://fallback/knowledge';
    expect(getStorageDatabaseEnv()?.name).toBe(KNOWLEDGE_STORAGE_FALLBACK_ENV);
    expect(getStorageDatabaseUrl()).toBe('postgres://fallback/knowledge');
    expect(getStorageMode()).toBe('hybrid');

    process.env[KNOWLEDGE_STORAGE_ENV] = 'postgres://primary/knowledge';
    expect(getStorageDatabaseEnv()?.name).toBe(KNOWLEDGE_STORAGE_ENV);
    expect(getStorageDatabaseUrl()).toBe('postgres://primary/knowledge');

    process.env[KNOWLEDGE_STORAGE_MODE_ENV] = 'remote';
    expect(getStorageMode()).toBe('remote');

    process.env[KNOWLEDGE_STORAGE_MODE_ENV] = 'invalid';
    process.env[KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV] = 'local';
    expect(getStorageMode()).toBe('local');
  });

  test('exposes durable knowledge tables and excludes local FTS indexes', () => {
    expect(STORAGE_TABLES).toContain('sources');
    expect(STORAGE_TABLES).toContain('chunks');
    expect(STORAGE_TABLES).toContain('vector_index_entries');
    expect(STORAGE_TABLES).toContain('knowledge_machines');
    expect(STORAGE_TABLES).toContain('knowledge_sync_snapshots');
    expect(STORAGE_TABLES).toContain('knowledge_sync_changes');
    expect(STORAGE_TABLES).toContain('knowledge_sync_conflicts');
    expect(STORAGE_TABLES).not.toContain('chunks_fts');
    expect(resolveTables()).toEqual([...STORAGE_TABLES]);
    expect(parseStorageTables('sources,chunks')).toEqual(['sources', 'chunks']);
    expect(() => resolveTables(['chunks_fts'])).toThrow('Unknown knowledge sync table');
  });

  test('storage status initializes scoped local sync metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-storage-status-'));
    const status = getStorageStatus({ scope: 'project', cwd: dir });

    expect(status).toMatchObject({
      configured: false,
      mode: 'local',
      service: 'knowledge',
      scope: 'project',
      activeEnv: null,
      sync: [],
    });
    expect(status.databasePath).toBe(join(dir, '.hasna', 'apps', 'knowledge', 'knowledge.db'));
    expect(existsSync(status.databasePath)).toBe(true);
    expect(status.tables).toEqual(STORAGE_TABLES);
  });
});
