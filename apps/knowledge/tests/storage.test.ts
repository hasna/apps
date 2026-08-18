import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  STORAGE_TABLES,
  getStorageStatus,
  parseStorageTables,
  resolveTables,
} from '../src/storage';
import { projectKnowledgeHome } from '../src/workspace';

describe('knowledge database storage status (local, read-only)', () => {
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
      backend: 'sqlite',
      service: 'knowledge',
      scope: 'project',
      sync: [],
    });
    expect(existsSync(status.databasePath)).toBe(true);
    expect(realpathSync(status.databasePath)).toBe(realpathSync(join(projectKnowledgeHome(dir), 'knowledge.db')));
    expect(status.tables).toEqual(STORAGE_TABLES);
  });
});
