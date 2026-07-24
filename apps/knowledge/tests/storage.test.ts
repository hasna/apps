import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKnowledgeService } from '../src/service';
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
import {
  storagePull as storagePullInternal,
  storagePush as storagePushInternal,
} from '../src/db/storage-sync';
import { defaultKnowledgeConfig, writeKnowledgeConfig } from '../src/workspace';

const storagePush = storagePushInternal;
const storagePull = storagePullInternal;

const ENV_KEYS = [
  KNOWLEDGE_STORAGE_ENV,
  KNOWLEDGE_STORAGE_FALLBACK_ENV,
  KNOWLEDGE_STORAGE_MODE_ENV,
  KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV,
] as const;

function expectedProjectKnowledgeHome(projectDir: string): string {
  return join(realpathSync(projectDir), '.hasna', 'knowledge');
}

class FakePgStorageAdapter {
  readonly tables = new Map<string, Map<string, Record<string, unknown>>>();
  closed = false;

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    const match = /INSERT INTO "([^"]+)"\s*\(([^)]+)\)/i.exec(sql);
    if (!match) return { changes: 0 };
    const table = match[1]!;
    const columns = [...match[2]!.matchAll(/"([^"]+)"/g)].map((entry) => entry[1]!);
    const row: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      row[column] = params[index] ?? null;
    });
    const key = String(row.id ?? row.machine_id ?? row.bundle_id ?? columns.map((column) => row[column]).join('\u0000'));
    if (!this.tables.has(table)) this.tables.set(table, new Map());
    this.tables.get(table)!.set(key, row);
    return { changes: 1 };
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    if (sql.includes('information_schema.columns')) return [];
    const match = /SELECT \* FROM "([^"]+)"/i.exec(sql);
    if (!match) return [];
    return [...(this.tables.get(match[1]!)?.values() ?? [])].map((row) => ({ ...row }));
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  count(table: string): number {
    return this.tables.get(table)?.size ?? 0;
  }
}

function configureHostedS3(cwd: string) {
  const service = createKnowledgeService({ scope: 'project', cwd });
  const workspace = service.ensureWorkspace();
  const config = defaultKnowledgeConfig();
  config.mode = 'local';
  config.storage = {
    type: 's3',
    artifacts_root: 'artifacts',
    s3: {
      bucket: 'knowledge-bucket',
      prefix: 'org/project/knowledge',
      region: 'us-east-1',
    },
  };
  writeFileSync(workspace.configPath, `${JSON.stringify(config)}\n`);
  return { service, workspace };
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('knowledge database storage sync config', () => {
  test('public storage env and mode helpers are fixed zero-read stubs', () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(getStorageDatabaseEnv()).toBeNull();
    expect(getStorageDatabaseUrl()).toBeNull();
    expect(getStorageMode()).toBe('local');

    // PURE REMOTE (A1): a DATABASE_URL alone no longer implies cloud/hybrid.
    process.env[KNOWLEDGE_STORAGE_FALLBACK_ENV] = 'postgres://fallback/knowledge';
    expect(getStorageDatabaseEnv()).toBeNull();
    expect(getStorageDatabaseUrl()).toBeNull();
    expect(getStorageMode()).toBe('local');

    delete process.env[KNOWLEDGE_STORAGE_FALLBACK_ENV];
    process.env[KNOWLEDGE_STORAGE_ENV] = 'postgres://primary/knowledge';
    expect(getStorageDatabaseEnv()).toBeNull();
    expect(getStorageDatabaseUrl()).toBeNull();

    // Canonical cloud mode, plus deprecated aliases that normalize to cloud.
    process.env[KNOWLEDGE_STORAGE_MODE_ENV] = 'cloud';
    expect(getStorageMode()).toBe('local');
    process.env[KNOWLEDGE_STORAGE_MODE_ENV] = 'remote';
    expect(getStorageMode()).toBe('local');
    process.env[KNOWLEDGE_STORAGE_MODE_ENV] = 'hybrid';
    expect(getStorageMode()).toBe('local');

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

  test('storage status returns fixed zero-I/O compatibility metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-storage-status-'));
    const status = getStorageStatus({ scope: 'project', cwd: dir });

    expect(status).toMatchObject({
      configured: false,
      mode: 'local',
      service: 'knowledge',
      scope: 'contained',
      activeEnv: null,
      databasePath: '[contained-zero-io]',
      sync: [],
    });
    expect(existsSync(join(dir, '.hasna'))).toBe(false);
    expect(status.tables).toEqual(STORAGE_TABLES);
  });

  test('persisted S3 intent contains service and sync before SQLite or fake PostgreSQL access', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'ok-hosted-storage-source-'));
    const targetDir = mkdtempSync(join(tmpdir(), 'ok-hosted-storage-target-'));
    const { service: sourceService, workspace: sourceWorkspace } = configureHostedS3(sourceDir);
    const { service: targetService, workspace: targetWorkspace } = configureHostedS3(targetDir);
    const remote = new FakePgStorageAdapter();
    const tables = ['sources', 'source_revisions', 'chunks', 'storage_objects'];
    expect(() => sourceService.initDb()).toThrow('KNOWLEDGE_CONFIG_INVALID');
    expect(() => targetService.dbStats()).toThrow('KNOWLEDGE_CONFIG_INVALID');
    await expect(storagePush({ scope: 'project', cwd: sourceDir, tables, remote }))
      .rejects.toThrow('KNOWLEDGE_HOSTED_CONTAINED');
    await expect(storagePull({ scope: 'project', cwd: targetDir, tables, remote }))
      .rejects.toThrow('KNOWLEDGE_HOSTED_CONTAINED');
    expect(remote.count('sources')).toBe(0);
    expect(remote.count('storage_objects')).toBe(0);
    expect(existsSync(sourceWorkspace.knowledgeDbPath)).toBe(false);
    expect(existsSync(targetWorkspace.knowledgeDbPath)).toBe(false);
  });
});
