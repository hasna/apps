import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeArtifactKey, type ArtifactStore, type ArtifactWrite } from '../src/artifact-store';
import { openKnowledgeDb } from '../src/knowledge-db';
import { createKnowledgeService } from '../src/service';
import { recordStorageObjects } from '../src/storage-contract';
import {
  applyKnowledgeSyncBundle,
  type KnowledgeSyncBundle,
  type KnowledgeSyncBundleArtifact,
  createKnowledgeSyncSnapshot,
  recordKnowledgeSyncConflict,
  syncArtifactsFromSnapshot,
  syncTablesFromSnapshot,
} from '../src/sync';
import type { KnowledgeMachineTopology } from '../src/machines';
import { defaultKnowledgeConfig, writeKnowledgeConfig } from '../src/workspace';

class FakeS3ArtifactStore implements ArtifactStore {
  readonly type = 's3' as const;
  readonly canRead = true;
  readonly canWrite = true;
  readonly writes: Array<{ key: string; object_key: string; uri: string; body: Buffer; content_type?: string }> = [];

  constructor(private readonly bucket: string, private readonly prefix = '') {}

  private objectKey(key: string): string {
    const logicalKey = normalizeArtifactKey(key);
    const prefix = this.prefix.replace(/^\/+|\/+$/g, '');
    return prefix ? `${prefix}/${logicalKey}` : logicalKey;
  }

  async put(entry: ArtifactWrite): Promise<{ key: string; uri: string; modified_at: string }> {
    const key = normalizeArtifactKey(entry.key);
    const objectKey = this.objectKey(key);
    const uri = `s3://${this.bucket}/${objectKey}`;
    this.writes.push({
      key,
      object_key: objectKey,
      uri,
      body: Buffer.from(entry.body),
      content_type: entry.content_type,
    });
    return { key, uri, modified_at: '2026-06-09T00:00:00.000Z' };
  }

  async getText(key: string): Promise<string> {
    const objectKey = this.objectKey(key);
    const write = this.writes.find((entry) => entry.object_key === objectKey);
    return write?.body.toString('utf8') ?? '';
  }

  async exists(key: string): Promise<boolean> {
    const objectKey = this.objectKey(key);
    return this.writes.some((entry) => entry.object_key === objectKey);
  }
}

function configureS3Service(service: ReturnType<typeof createKnowledgeService>, input: {
  bucket?: string;
  prefix?: string;
} = {}) {
  const workspace = service.ensureWorkspace();
  const config = defaultKnowledgeConfig();
  config.mode = 'hosted';
  config.storage = {
    type: 's3',
    artifacts_root: 'artifacts',
    s3: {
      bucket: input.bucket ?? 'knowledge-bucket',
      prefix: input.prefix ?? 'org/project/knowledge',
      region: 'us-east-1',
    },
  };
  writeKnowledgeConfig(workspace.configPath, config);
  return { workspace, config };
}

function asS3ManifestOnlyBundle(bundle: KnowledgeSyncBundle, uriPrefix: string): KnowledgeSyncBundle {
  const artifactUriMap = new Map<string, string>();
  const artifacts = bundle.artifacts.map((artifact): KnowledgeSyncBundleArtifact => {
    const nextUri = artifact.key ? `${uriPrefix}${artifact.key}` : artifact.artifact_uri;
    artifactUriMap.set(artifact.artifact_uri, nextUri);
    const { content_base64: _content, ...rest } = artifact;
    return {
      ...rest,
      artifact_uri: nextUri,
    };
  });
  return {
    ...bundle,
    source: {
      ...bundle.source,
      artifact_root_uri: uriPrefix,
    },
    tables: bundle.tables.map((table) => ({
      ...table,
      rows: table.rows.map((row) => {
        if (typeof row.artifact_uri === 'string' && artifactUriMap.has(row.artifact_uri)) {
          return { ...row, artifact_uri: artifactUriMap.get(row.artifact_uri)! };
        }
        return row;
      }),
    })),
    artifacts,
    warnings: [...bundle.warnings, ...artifacts.map((artifact) => `artifact_content_not_embedded:${artifact.artifact_uri}`)],
  };
}

function fakeTopology(workspaceHome: string): KnowledgeMachineTopology {
  return {
    ok: true,
    source: 'open-machines',
    generated_at: '2026-06-09T00:00:00.000Z',
    local_machine_id: 'spark02',
    local_hostname: 'spark02',
    current_platform: 'linux',
    knowledge: {
      scope: 'project',
      app_path: '.hasna/apps/knowledge',
      workspace_home: workspaceHome,
    },
    machines: [
      {
        machine_id: 'spark02',
        hostname: 'spark02',
        local: true,
        platform: 'linux',
        os: 'linux',
        user: 'hasna',
        workspace_path: workspaceHome,
        manifest_declared: true,
        heartbeat_status: 'online',
        last_heartbeat_at: '2026-06-09T00:00:00.000Z',
        tailscale: {
          dns_name: 'spark02.example.ts.net',
          ips: ['100.64.0.2'],
          online: true,
          active: true,
          last_seen: null,
        },
        ssh: {
          address: 'spark02',
          route: 'local',
          command_target: 'localhost',
        },
        route_hints: [{ kind: 'local', target: 'localhost', reachable: true }],
        tags: ['sync'],
        metadata: { role: 'workstation' },
        source: 'open-machines',
      },
      {
        machine_id: 'spark01',
        hostname: 'spark01',
        local: false,
        platform: 'linux',
        os: 'linux',
        user: 'hasna',
        workspace_path: '/home/hasna/workspace/hasna/opensource/open-knowledge',
        manifest_declared: true,
        heartbeat_status: 'online',
        last_heartbeat_at: '2026-06-09T00:00:00.000Z',
        tailscale: {
          dns_name: 'spark01.example.ts.net',
          ips: ['100.64.0.1'],
          online: true,
          active: true,
          last_seen: null,
        },
        ssh: {
          address: 'spark01',
          route: 'tailscale',
          command_target: 'spark01.example.ts.net',
        },
        route_hints: [{ kind: 'tailscale', target: 'spark01.example.ts.net', reachable: true }],
        tags: ['sync'],
        metadata: { role: 'remote' },
        source: 'open-machines',
      },
    ],
    warnings: [],
    adapter: {
      package: '@hasna/machines',
      available: true,
      error: null,
    },
    message: '2 machine(s) discovered',
  };
}

describe('knowledge machine sync ledger', () => {
  test('records machine registry rows, snapshots, artifact hashes, and conflicts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sync-'));
    const service = createKnowledgeService({ scope: 'project', cwd: dir });
    const workspace = service.paths();
    service.initDb();

    const db = openKnowledgeDb(workspace.knowledge_db_path);
    try {
      recordStorageObjects(db, [{
        uri: `file://${workspace.artifacts_dir}/wiki/generated/handbook.md`,
        key: 'wiki/generated/handbook.md',
        kind: 'wiki_page',
        content_type: 'text/markdown',
        hash: 'sha256:handbook',
        size_bytes: 128,
      }], new Date('2026-06-09T00:00:00.000Z'));
    } finally {
      db.close();
    }

    const snapshot = createKnowledgeSyncSnapshot({
      dbPath: workspace.knowledge_db_path,
      scope: 'project',
      workspaceHome: workspace.home,
      storage: service.storageContract(),
      topology: fakeTopology(workspace.home),
      now: new Date('2026-06-09T00:00:00.000Z'),
    });

    expect(snapshot.machines_upserted).toBe(2);
    expect(snapshot.snapshot.machine_id).toBe('spark02');
    expect(snapshot.snapshot.content_hash).toStartWith('sha256:');
    expect(snapshot.snapshot.tables.storage_objects).toBe(1);
    expect(snapshot.snapshot.tables.knowledge_machines).toBe(2);
    expect(snapshot.snapshot.artifact_hashes).toEqual([{
      artifact_uri: `file://${workspace.artifacts_dir}/wiki/generated/handbook.md`,
      kind: 'wiki_page',
      hash: 'sha256:handbook',
      size_bytes: 128,
    }]);
    expect(syncTablesFromSnapshot(snapshot.snapshot).storage_objects).toBe(1);
    expect(syncArtifactsFromSnapshot(snapshot.snapshot)).toHaveLength(1);

    const status = service.syncStatus();
    expect(status.sqlite_schema_version).toBe(7);
    expect(status.machines.total).toBe(2);
    expect(status.snapshots.total).toBe(1);
    expect(status.clocks.total).toBeGreaterThan(0);
    expect(status.imports.total).toBe(0);
    expect(status.snapshots.latest?.id).toBe(snapshot.snapshot.id);
    expect(status.conflicts.open).toBe(0);

    const conflict = recordKnowledgeSyncConflict(workspace.knowledge_db_path, {
      entityKind: 'wiki_page',
      entityId: 'wiki/generated/handbook.md',
      localMachineId: 'spark02',
      remoteMachineId: 'spark01',
      localHash: 'sha256:local',
      remoteHash: 'sha256:remote',
      baseHash: 'sha256:base',
      metadata: { reason: 'same wiki path changed on two machines' },
    });
    expect(conflict.status).toBe('open');

    const conflicts = service.syncConflicts({ status: 'open' });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].metadata).toMatchObject({
      reason: 'same wiki path changed on two machines',
    });

    const statusAfterConflict = service.syncStatus();
    expect(statusAfterConflict.conflicts.open).toBe(1);
    expect(statusAfterConflict.table_counts.knowledge_sync_conflicts).toBe(1);

    const shown = service.syncConflict(conflict.id);
    expect(shown.id).toBe(conflict.id);
    const proposal = service.proposeSyncConflictResolution(conflict.id);
    expect(proposal.requires_approval).toBe(true);
    expect(proposal.merge_prompt).toContain('Do not write changes without approval');

    const blockedResolution = service.resolveSyncConflict({
      id: conflict.id,
      strategy: 'manual-merge',
    });
    expect(blockedResolution.ok).toBe(false);
    expect(blockedResolution.approval_required).toBe(true);
    expect(service.syncConflict(conflict.id).status).toBe('open');

    const approvedResolution = service.resolveSyncConflict({
      id: conflict.id,
      strategy: 'manual-merge',
      approveWrite: true,
      approvedBy: 'test-reviewer',
      proposedPatchUri: 'file:///tmp/proposed.patch',
    });
    expect(approvedResolution.ok).toBe(true);
    expect(approvedResolution.conflict.status).toBe('resolved');
    expect(approvedResolution.conflict.approved_by).toBe('test-reviewer');
    expect(approvedResolution.audit_event_id).toStartWith('audit_');
    expect(service.syncConflicts({ status: 'resolved' })).toHaveLength(1);
  });

  test('dry-runs and pushes rows plus generated artifacts between project workspaces', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'ok-sync-source-'));
    const peerDir = mkdtempSync(join(tmpdir(), 'ok-sync-peer-'));
    const sourceService = createKnowledgeService({ scope: 'project', cwd: sourceDir });
    const peerService = createKnowledgeService({ scope: 'project', cwd: peerDir });
    const sourcePath = join(sourceDir, 'handbook.md');
    writeFileSync(sourcePath, 'Peer sync should copy derived chunks and generated wiki artifacts.');

    sourceService.initDb();
    peerService.initDb();
    await sourceService.ingestSource(`file://${sourcePath}`, 'knowledge_index');
    await sourceService.initWiki();

    const dryRun = await sourceService.syncPeer({
      peerWorkspace: peerDir,
      direction: 'push',
      dryRun: true,
      includeArtifactContent: true,
    });
    expect(dryRun.ok).toBe(true);
    expect(dryRun.resolved_workspace).toMatchObject({
      source: 'argument',
      adapter: {
        implementation: 'disabled',
        error: 'argument_override',
      },
    });
    expect(dryRun.push?.dry_run).toBe(true);
    expect(dryRun.push?.tables.find((table) => table.table === 'sources')?.inserted).toBe(1);
    expect(peerService.dbStats().sources).toBe(0);
    expect(existsSync(join(peerDir, '.hasna', 'apps', 'knowledge', 'artifacts', 'wiki', 'README.md'))).toBe(false);

    const push = await sourceService.syncPeer({
      peerWorkspace: peerDir,
      direction: 'push',
      includeArtifactContent: true,
    });
    expect(push.ok).toBe(true);
    expect(push.resolved_workspace?.project_root).toBe(peerDir);
    expect(push.push?.bundle_id).toStartWith('syncbundle_');
    expect(push.push?.replayed).toBe(false);
    expect(push.push?.clocks.advanced).toBeGreaterThan(0);
    expect(push.push?.artifacts.copied).toBeGreaterThanOrEqual(1);

    const peerStats = peerService.dbStats();
    expect(peerStats.sources).toBe(1);
    expect(peerStats.chunks).toBeGreaterThanOrEqual(1);
    expect(peerStats.storage_objects).toBe(4);
    expect(existsSync(join(peerDir, '.hasna', 'apps', 'knowledge', 'artifacts', 'wiki', 'README.md'))).toBe(true);

    const secondDryRun = await sourceService.syncPeer({
      peerWorkspace: peerDir,
      direction: 'push',
      dryRun: true,
      includeArtifactContent: true,
    });
    expect(secondDryRun.ok).toBe(true);
    expect(secondDryRun.push?.tables.reduce((sum, table) => sum + table.inserted, 0)).toBe(0);
    expect(secondDryRun.push?.artifacts.copied).toBe(0);

    const replay = await sourceService.syncPeer({
      peerWorkspace: peerDir,
      direction: 'push',
      includeArtifactContent: true,
    });
    expect(replay.ok).toBe(true);
    expect(replay.push?.replayed).toBe(true);
    expect(replay.push?.tables.reduce((sum, table) => sum + table.inserted, 0)).toBe(0);
  });

  test('syncs generated artifact manifests through fake S3 without raw source bytes', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'ok-sync-fake-s3-source-'));
    const s3TargetDir = mkdtempSync(join(tmpdir(), 'ok-sync-fake-s3-target-'));
    const localTargetDir = mkdtempSync(join(tmpdir(), 'ok-sync-fake-s3-local-target-'));
    const sharedS3TargetDir = mkdtempSync(join(tmpdir(), 'ok-sync-fake-s3-shared-target-'));
    const sourceService = createKnowledgeService({ scope: 'project', cwd: sourceDir });
    const s3TargetService = createKnowledgeService({ scope: 'project', cwd: s3TargetDir });
    const localTargetService = createKnowledgeService({ scope: 'project', cwd: localTargetDir });
    const sharedS3TargetService = createKnowledgeService({ scope: 'project', cwd: sharedS3TargetDir });

    sourceService.initDb();
    await sourceService.initWiki();
    const sourceBundle = sourceService.exportSyncBundle({
      machineId: 'fake-s3-source',
      includeArtifactContent: true,
    });

    const { workspace: s3Workspace } = configureS3Service(s3TargetService);
    s3TargetService.initDb();
    const fakeS3Store = new FakeS3ArtifactStore('knowledge-bucket', 'org/project/knowledge');
    const localToS3 = await applyKnowledgeSyncBundle({
      targetDbPath: s3Workspace.knowledgeDbPath,
      targetScope: 'project',
      targetWorkspaceHome: s3Workspace.home,
      targetStorage: s3TargetService.storageContract(),
      targetStore: fakeS3Store,
      bundle: sourceBundle,
      direction: 'push',
      localMachineId: 'fake-s3-target',
    });

    expect(localToS3.ok).toBe(true);
    expect(localToS3.artifacts.copied).toBe(sourceBundle.artifacts.length);
    expect(localToS3.artifacts.missing_content).toBe(0);
    expect(fakeS3Store.writes).toHaveLength(sourceBundle.artifacts.length);
    expect(fakeS3Store.writes.some((entry) => entry.key === 'wiki/README.md')).toBe(true);
    expect(fakeS3Store.writes.every((entry) => entry.object_key.startsWith('org/project/knowledge/'))).toBe(true);

    const s3Rows = openKnowledgeDb(s3Workspace.knowledgeDbPath);
    try {
      const rows = s3Rows.query<{
        artifact_uri: string;
        hash: string | null;
        size_bytes: number | null;
        metadata_json: string;
      }, []>('SELECT artifact_uri, hash, size_bytes, metadata_json FROM storage_objects ORDER BY artifact_uri ASC').all();
      expect(rows).toHaveLength(sourceBundle.artifacts.length);
      for (const row of rows) {
        const metadata = JSON.parse(row.metadata_json);
        expect(row.artifact_uri).toStartWith('s3://knowledge-bucket/org/project/knowledge/');
        expect(row.hash).toStartWith('sha256:');
        expect(row.size_bytes).toBeGreaterThan(0);
        expect(metadata.key).toBeString();
        expect(Number.isNaN(Date.parse(metadata.artifact_modified_at))).toBe(false);
        expect(metadata.provenance).toMatchObject({
          artifact_key: metadata.key,
          raw_source_bytes_stored_in_open_knowledge: false,
        });
        expect(metadata.key).not.toStartWith('org/project/knowledge/');
        expect(JSON.stringify(metadata)).not.toContain('content_base64');
        expect(JSON.stringify(metadata)).not.toContain('raw_content');
      }
    } finally {
      s3Rows.close();
    }
    const s3Doctor = await s3TargetService.syncDoctor();
    expect(s3Doctor.ok).toBe(true);
    expect(s3Doctor.storage.artifact_manifest).toMatchObject({
      ok: true,
      storage_type: 's3',
      artifacts: { total: sourceBundle.artifacts.length },
      uri_prefix: { mismatched: 0 },
      keys: { prefixed_with_storage_prefix: 0 },
      raw_payload_sentinel_hits: 0,
      sync_manifest: {
        generated_artifacts_only: true,
        includes_raw_source_bytes: false,
        portable_keys: true,
        preserves_provenance: true,
      },
    });

    const s3ManifestOnly = asS3ManifestOnlyBundle(sourceBundle, 's3://knowledge-bucket/org/project/knowledge/');
    localTargetService.initDb();
    const s3ToLocal = await applyKnowledgeSyncBundle({
      targetDbPath: localTargetService.paths().knowledge_db_path,
      targetScope: 'project',
      targetWorkspaceHome: localTargetService.paths().home,
      targetStorage: localTargetService.storageContract(),
      targetStore: localTargetService.artifactStore(),
      bundle: s3ManifestOnly,
      direction: 'pull',
      localMachineId: 'fake-local-target',
    });
    expect(s3ToLocal.artifacts.copied).toBe(0);
    expect(s3ToLocal.artifacts.missing_content).toBe(sourceBundle.artifacts.length);
    expect(s3ToLocal.warnings.filter((warning) => warning.startsWith('artifact_content_missing:'))).toHaveLength(sourceBundle.artifacts.length);
    expect(localTargetService.dbStats().storage_objects).toBe(0);

    const { workspace: sharedS3Workspace } = configureS3Service(sharedS3TargetService);
    sharedS3TargetService.initDb();
    const sharedS3Store = new FakeS3ArtifactStore('knowledge-bucket', 'org/project/knowledge');
    const s3ToSharedS3 = await applyKnowledgeSyncBundle({
      targetDbPath: sharedS3Workspace.knowledgeDbPath,
      targetScope: 'project',
      targetWorkspaceHome: sharedS3Workspace.home,
      targetStorage: sharedS3TargetService.storageContract(),
      targetStore: sharedS3Store,
      bundle: s3ManifestOnly,
      direction: 'pull',
      localMachineId: 'fake-shared-s3-target',
    });
    expect(s3ToSharedS3.ok).toBe(true);
    expect(s3ToSharedS3.artifacts.copied).toBe(sourceBundle.artifacts.length);
    expect(s3ToSharedS3.artifacts.missing_content).toBe(0);
    expect(sharedS3Store.writes).toHaveLength(0);
    expect(sharedS3TargetService.dbStats().storage_objects).toBe(sourceBundle.artifacts.length);
    const sharedDoctor = await sharedS3TargetService.syncDoctor();
    expect(sharedDoctor.storage.artifact_manifest).toMatchObject({
      ok: true,
      storage_type: 's3',
      artifacts: { total: sourceBundle.artifacts.length },
      uri_prefix: { mismatched: 0 },
      sync_manifest: {
        includes_raw_source_bytes: false,
        portable_keys: true,
        preserves_provenance: true,
      },
    });
  });

  test('records conflicts instead of overwriting divergent peer rows', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'ok-sync-conflict-source-'));
    const peerDir = mkdtempSync(join(tmpdir(), 'ok-sync-conflict-peer-'));
    const sourceService = createKnowledgeService({ scope: 'project', cwd: sourceDir });
    const peerService = createKnowledgeService({ scope: 'project', cwd: peerDir });
    sourceService.initDb();
    peerService.initDb();
    await sourceService.initWiki();
    await sourceService.syncPeer({ peerWorkspace: peerDir, direction: 'push' });

    const peerDb = openKnowledgeDb(peerService.paths().knowledge_db_path);
    try {
      peerDb.query('UPDATE wiki_pages SET title = ?, updated_at = ? WHERE path = ?')
        .run('Peer edited README', '2026-06-09T00:00:00.000Z', 'wiki/README.md');
    } finally {
      peerDb.close();
    }

    const push = await sourceService.syncPeer({ peerWorkspace: peerDir, direction: 'push' });
    expect(push.ok).toBe(false);
    expect(push.push?.tables.find((table) => table.table === 'wiki_pages')?.conflicts).toBe(1);
    const openConflicts = peerService.syncConflicts({ status: 'open' });
    const wikiConflict = openConflicts.find((conflict) => conflict.entity_kind === 'wiki_pages');
    expect(wikiConflict).toBeTruthy();
    expect(wikiConflict?.metadata.local_row).toMatchObject({ title: 'Peer edited README' });
    expect(wikiConflict?.metadata.remote_row).toMatchObject({ title: 'Wiki' });

    const unchanged = openKnowledgeDb(peerService.paths().knowledge_db_path);
    try {
      const row = unchanged.query<{ title: string }, [string]>('SELECT title FROM wiki_pages WHERE path = ?').get('wiki/README.md');
      expect(row?.title).toBe('Peer edited README');
    } finally {
      unchanged.close();
    }
  });

  test('guards duplicate, interrupted, and out-of-order bundle imports with table clocks', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'ok-sync-clock-source-'));
    const peerDir = mkdtempSync(join(tmpdir(), 'ok-sync-clock-peer-'));
    const sourceService = createKnowledgeService({ scope: 'project', cwd: sourceDir });
    const peerService = createKnowledgeService({ scope: 'project', cwd: peerDir });
    sourceService.initDb();
    peerService.initDb();
    await sourceService.initWiki();

    const v1 = sourceService.exportSyncBundle({
      machineId: 'source-clock',
      includeArtifactContent: true,
    });
    const first = await peerService.importSyncBundle({
      bundle: v1,
      machineId: 'peer-clock',
    });
    expect(first.ok).toBe(true);
    expect(first.replayed).toBe(false);
    expect(first.clocks.advanced).toBeGreaterThan(0);

    const duplicate = await peerService.importSyncBundle({
      bundle: v1,
      machineId: 'peer-clock',
    });
    expect(duplicate.ok).toBe(true);
    expect(duplicate.replayed).toBe(true);
    expect(duplicate.conflicts_created).toBe(0);

    const peerDb = openKnowledgeDb(peerService.paths().knowledge_db_path);
    try {
      peerDb.query('DELETE FROM knowledge_sync_imports WHERE bundle_id = ?').run(v1.bundle_id);
    } finally {
      peerDb.close();
    }
    const interruptedReplay = await peerService.importSyncBundle({
      bundle: v1,
      machineId: 'peer-clock',
    });
    expect(interruptedReplay.ok).toBe(true);
    expect(interruptedReplay.replayed).toBe(false);
    expect(interruptedReplay.tables.reduce((sum, table) => sum + table.inserted, 0)).toBe(0);
    expect(interruptedReplay.conflicts_created).toBe(0);

    const sourcePath = join(sourceDir, 'clock-source.md');
    writeFileSync(sourcePath, 'Clock guards should accept newer inserted rows and reject old table watermarks.');
    await sourceService.ingestSource(`file://${sourcePath}`, 'knowledge_index');
    const v2 = sourceService.exportSyncBundle({
      machineId: 'source-clock',
      includeArtifactContent: true,
    });
    expect(v2.bundle_id).not.toBe(v1.bundle_id);
    const newer = await peerService.importSyncBundle({
      bundle: v2,
      machineId: 'peer-clock',
    });
    expect(newer.ok).toBe(true);
    expect(newer.tables.find((table) => table.table === 'sources')?.inserted).toBe(1);

    const stale = await peerService.importSyncBundle({
      bundle: v1,
      machineId: 'peer-clock',
    });
    expect(stale.ok).toBe(true);
    expect(stale.replayed).toBe(false);
    expect(stale.clocks.stale_tables).toBeGreaterThan(0);
    expect(stale.warnings.some((warning) => warning.startsWith('stale_table_skipped:'))).toBe(true);
    expect(peerService.dbStats().sources).toBe(1);
  });
});
