import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openKnowledgeDb } from '../src/knowledge-db';
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
  storagePull,
  storagePush,
  type StorageRemoteAdapter,
} from '../src/storage';
import { recordStorageObjects } from '../src/storage-contract';
import { defaultKnowledgeConfig, writeKnowledgeConfig } from '../src/workspace';

const ENV_KEYS = [
  KNOWLEDGE_STORAGE_ENV,
  KNOWLEDGE_STORAGE_FALLBACK_ENV,
  KNOWLEDGE_STORAGE_MODE_ENV,
  KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV,
] as const;

class FakePgStorageAdapter implements StorageRemoteAdapter {
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
  config.mode = 'hosted';
  config.storage = {
    type: 's3',
    artifacts_root: 'artifacts',
    s3: {
      bucket: 'knowledge-bucket',
      prefix: 'org/project/knowledge',
      region: 'us-east-1',
    },
  };
  writeKnowledgeConfig(workspace.configPath, config);
  service.initDb();
  return { service, workspace };
}

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

  test('pushes hosted-ready catalog rows and S3 artifact manifests through a fake PostgreSQL adapter', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'ok-hosted-storage-source-'));
    const targetDir = mkdtempSync(join(tmpdir(), 'ok-hosted-storage-target-'));
    const { service: sourceService, workspace: sourceWorkspace } = configureHostedS3(sourceDir);
    const { service: targetService, workspace: targetWorkspace } = configureHostedS3(targetDir);
    const manifestPath = join(sourceDir, 'open-files-manifest.jsonl');
    writeFileSync(manifestPath, `${JSON.stringify({
      source_ref: 'open-files://file/hosted_fixture/revision/rev_hosted_001',
      source_uri: 'open-files://file/hosted_fixture',
      title: 'Hosted Fixture',
      revision: 'rev_hosted_001',
      hash: 'sha256:hosted-source',
      extracted_text: 'Hosted storage sync should move derived chunks and source refs, not raw open-files bytes.',
      metadata: {
        source_ref: 'open-files://file/hosted_fixture/revision/rev_hosted_001',
      },
    })}\n`);
    await sourceService.ingestManifest(manifestPath);
    const sourceDb = openKnowledgeDb(sourceWorkspace.knowledgeDbPath);
    try {
      recordStorageObjects(sourceDb, [{
        uri: 's3://knowledge-bucket/org/project/knowledge/wiki/hosted-fixture.md',
        key: 'wiki/hosted-fixture.md',
        kind: 'wiki_page',
        content_type: 'text/markdown',
        hash: 'sha256:hosted-artifact',
        size_bytes: 512,
        modified_at: '2026-06-09T00:00:00.000Z',
        metadata: {
          provenance: {
            source_owner: 'open-files',
            generated_from: 'hosted-storage-fixture',
            artifact_key: 'wiki/hosted-fixture.md',
            raw_source_bytes_stored_in_open_knowledge: false,
          },
        },
      }], new Date('2026-06-09T00:00:00.000Z'));
    } finally {
      sourceDb.close();
    }

    const remote = new FakePgStorageAdapter();
    const tables = ['sources', 'source_revisions', 'chunks', 'storage_objects'];
    const push = await storagePush({ scope: 'project', cwd: sourceDir, tables, remote });
    expect(push.every((result) => result.errors.length === 0)).toBe(true);
    expect(push.find((result) => result.table === 'sources')?.rowsWritten).toBe(1);
    expect(push.find((result) => result.table === 'storage_objects')?.rowsWritten).toBe(1);
    expect(remote.count('sources')).toBe(1);
    expect(remote.count('storage_objects')).toBe(1);

    const secondPush = await storagePush({ scope: 'project', cwd: sourceDir, tables, remote });
    expect(secondPush.every((result) => result.errors.length === 0)).toBe(true);
    expect(remote.count('sources')).toBe(1);
    expect(remote.count('storage_objects')).toBe(1);

    const dryRun = await sourceService.syncPeer({
      peerWorkspace: targetDir,
      direction: 'push',
      dryRun: true,
      includeArtifactContent: false,
    });
    expect(dryRun.ok).toBe(true);
    expect(dryRun.push?.dry_run).toBe(true);
    expect(dryRun.push?.artifacts.copied).toBe(1);
    expect(targetService.dbStats().storage_objects).toBe(0);

    const pull = await storagePull({ scope: 'project', cwd: targetDir, tables, remote });
    expect(pull.every((result) => result.errors.length === 0)).toBe(true);
    expect(pull.find((result) => result.table === 'chunks')?.rowsWritten).toBeGreaterThan(0);
    expect(targetService.dbStats().sources).toBe(1);
    expect(targetService.dbStats().storage_objects).toBe(1);

    const targetDb = openKnowledgeDb(targetWorkspace.knowledgeDbPath);
    try {
      const source = targetDb.query<{ uri: string; metadata_json: string }, []>('SELECT uri, metadata_json FROM sources LIMIT 1').get();
      expect(source?.uri).toBe('open-files://file/hosted_fixture');
      expect(JSON.stringify(JSON.parse(source?.metadata_json ?? '{}'))).not.toContain('raw_content');
      const object = targetDb.query<{ artifact_uri: string; metadata_json: string }, []>('SELECT artifact_uri, metadata_json FROM storage_objects LIMIT 1').get();
      const metadata = JSON.parse(object?.metadata_json ?? '{}');
      expect(object?.artifact_uri).toBe('s3://knowledge-bucket/org/project/knowledge/wiki/hosted-fixture.md');
      expect(metadata.key).toBe('wiki/hosted-fixture.md');
      expect(metadata.artifact_modified_at).toBe('2026-06-09T00:00:00.000Z');
      expect(metadata.provenance).toMatchObject({
        generated_from: 'hosted-storage-fixture',
        artifact_key: 'wiki/hosted-fixture.md',
        raw_source_bytes_stored_in_open_knowledge: false,
      });
      expect(JSON.stringify(metadata)).not.toContain('raw_content');
    } finally {
      targetDb.close();
    }

    const doctor = await targetService.syncDoctor();
    expect(doctor.ok).toBe(true);
    expect(doctor.open_files.raw_payload_sentinel_hits).toBe(0);
    expect(doctor.storage.artifact_manifest).toMatchObject({
      ok: true,
      storage_type: 's3',
      artifacts: { total: 1 },
      modified_time: {
        with_modified_at: 1,
        missing_modified_at: 0,
        invalid_modified_at: 0,
      },
      provenance: {
        with_provenance: 1,
        missing_provenance: 0,
        artifact_key_mismatches: 0,
      },
      sync_manifest: {
        includes_raw_source_bytes: false,
        preserves_provenance: true,
      },
    });

    const targetConflictDb = openKnowledgeDb(targetWorkspace.knowledgeDbPath);
    try {
      targetConflictDb.query('UPDATE storage_objects SET hash = ? WHERE artifact_uri = ?')
        .run('sha256:target-diverged', 's3://knowledge-bucket/org/project/knowledge/wiki/hosted-fixture.md');
    } finally {
      targetConflictDb.close();
    }
    const conflictPreview = await sourceService.syncPeer({
      peerWorkspace: targetDir,
      direction: 'push',
      dryRun: true,
      includeArtifactContent: false,
    });
    expect(conflictPreview.ok).toBe(false);
    expect(conflictPreview.push?.dry_run).toBe(true);
    expect(conflictPreview.push?.artifacts.conflicts).toBe(1);
    expect(targetService.syncConflicts({ status: 'open' })).toHaveLength(0);
  });
});
