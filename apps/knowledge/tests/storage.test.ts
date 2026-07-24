import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KNOWLEDGE_STORAGE_MODE_ENV,
  KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV,
  STORAGE_TABLES,
  getStorageMode,
  getStorageStatus,
  parseStorageTables,
  resolveTables,
} from '../src/storage';

const ENV_KEYS = [
  KNOWLEDGE_STORAGE_MODE_ENV,
  KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV,
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('knowledge database storage status (local, read-only)', () => {
  test('resolves the storage mode from the mode env only (no client DSN surface)', () => {
    for (const key of ENV_KEYS) delete process.env[key];
    // Default is local; the client has NO DATABASE_URL/DSN surface at all.
    expect(getStorageMode()).toBe('local');

    // Canonical cloud mode, plus deprecated aliases that normalize to cloud.
    process.env[KNOWLEDGE_STORAGE_MODE_ENV] = 'cloud';
    expect(getStorageMode()).toBe('cloud');
    process.env[KNOWLEDGE_STORAGE_MODE_ENV] = 'remote';
    expect(getStorageMode()).toBe('cloud');
    process.env[KNOWLEDGE_STORAGE_MODE_ENV] = 'hybrid';
    expect(getStorageMode()).toBe('cloud');

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
    expect(STORAGE_TABLES).toContain('knowledge_sync_table_clocks');
    expect(STORAGE_TABLES).toContain('knowledge_sync_imports');
    expect(STORAGE_TABLES).not.toContain('chunks_fts');
    expect(resolveTables()).toEqual([...STORAGE_TABLES]);
    expect(parseStorageTables('sources,chunks')).toEqual(['sources', 'chunks']);
    expect(() => resolveTables(['chunks_fts'])).toThrow('Unknown knowledge sync table');
  });

  test('storage status initializes scoped local sync metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-storage-status-'));
    const status = getStorageStatus({ scope: 'project', cwd: dir });

    expect(status).toMatchObject({
      mode: 'local',
      service: 'knowledge',
      scope: 'project',
      sync: [],
    });
    expect(existsSync(status.databasePath)).toBe(true);
    expect(realpathSync(status.databasePath)).toBe(realpathSync(join(dir, '.hasna', 'knowledge', 'knowledge.db')));
    expect(status.tables).toEqual(STORAGE_TABLES);
  });
});
