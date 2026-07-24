import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeArtifactKey, type ArtifactStore, type ArtifactWrite } from '../src/artifact-store';
import { openKnowledgeDb } from '../src/knowledge-db';
import { createKnowledgeService } from '../src/service';
import { recordStorageObjects } from '../src/storage-contract';
import {
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

  async delete(key: string): Promise<void> {
    const objectKey = this.objectKey(key);
    const index = this.writes.findIndex((entry) => entry.object_key === objectKey);
    if (index >= 0) this.writes.splice(index, 1);
  }

  async list(prefix = ''): Promise<string[]> {
    return this.writes
      .map((entry) => entry.key)
      .filter((key) => !prefix || key.startsWith(prefix))
      .sort();
  }
}

function configureS3Service(service: ReturnType<typeof createKnowledgeService>, input: {
  bucket?: string;
  prefix?: string;
} = {}) {
  const workspace = service.ensureWorkspace();
  const config = defaultKnowledgeConfig();
  config.mode = 'local';
  config.storage = {
    type: 's3',
    artifacts_root: 'artifacts',
    s3: {
      bucket: input.bucket ?? 'knowledge-bucket',
      prefix: input.prefix ?? 'org/project/knowledge',
      region: 'us-east-1',
    },
  };
  writeFileSync(workspace.configPath, `${JSON.stringify(config)}\n`);
  return { workspace, config };
}

function fakeTopology(workspaceHome: string): KnowledgeMachineTopology {
  return {
    ok: true,
    source: 'open-machines',
    generated_at: '2026-06-09T00:00:00.000Z',
    local_machine_id: 'linux-node-b',
    local_hostname: 'linux-node-b',
    current_platform: 'linux',
    knowledge: {
      scope: 'project',
      app_path: '.hasna/knowledge',
      workspace_home: workspaceHome,
    },
    machines: [
      {
        machine_id: 'linux-node-b',
        hostname: 'linux-node-b',
        local: true,
        platform: 'linux',
        os: 'linux',
        user: 'hasna',
        workspace_path: workspaceHome,
        manifest_declared: true,
        heartbeat_status: 'online',
        last_heartbeat_at: '2026-06-09T00:00:00.000Z',
        tailscale: {
          dns_name: 'linux-node-b.example.ts.net',
          ips: ['100.64.0.2'],
          online: true,
          active: true,
          last_seen: null,
        },
        ssh: {
          address: 'linux-node-b',
          route: 'local',
          command_target: 'localhost',
        },
        route_hints: [{ kind: 'local', target: 'localhost', reachable: true }],
        tags: ['sync'],
        metadata: { role: 'workstation' },
        source: 'open-machines',
      },
      {
        machine_id: 'linux-node-a',
        hostname: 'linux-node-a',
        local: false,
        platform: 'linux',
        os: 'linux',
        user: 'hasna',
        workspace_path: '/workspace/open-knowledge',
        manifest_declared: true,
        heartbeat_status: 'online',
        last_heartbeat_at: '2026-06-09T00:00:00.000Z',
        tailscale: {
          dns_name: 'linux-node-a.example.ts.net',
          ips: ['100.64.0.1'],
          online: true,
          active: true,
          last_seen: null,
        },
        ssh: {
          address: 'linux-node-a',
          route: 'tailscale',
          command_target: 'linux-node-a.example.ts.net',
        },
        route_hints: [{ kind: 'tailscale', target: 'linux-node-a.example.ts.net', reachable: true }],
        tags: ['sync'],
        metadata: { role: 'remote' },
        source: 'open-machines',
      },
    ],
    warnings: [],
    adapter: {
      package: '@hasna/machines',
      entrypoint: '@hasna/machines/consumer',
      mode: 'sdk',
      implementation: 'sdk',
      contract_version: 1,
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
    expect(snapshot.snapshot.machine_id).toBe('linux-node-b');
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
    expect(status.sqlite_schema_version).toBe(8);
    expect(status.machines.total).toBe(2);
    expect(status.snapshots.total).toBe(1);
    expect(status.clocks.total).toBeGreaterThan(0);
    expect(status.imports.total).toBe(0);
    expect(status.snapshots.latest?.id).toBe(snapshot.snapshot.id);
    expect(status.conflicts.open).toBe(0);

    const conflict = recordKnowledgeSyncConflict(workspace.knowledge_db_path, {
      entityKind: 'wiki_page',
      entityId: 'wiki/generated/handbook.md',
      localMachineId: 'linux-node-b',
      remoteMachineId: 'linux-node-a',
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
    if (!approvedResolution.ok) throw new Error('expected approved conflict resolution');
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
    expect(existsSync(join(peerDir, '.hasna', 'knowledge', 'artifacts', 'wiki', 'README.md'))).toBe(false);

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
    expect(existsSync(join(peerDir, '.hasna', 'knowledge', 'artifacts', 'wiki', 'README.md'))).toBe(true);

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

  test('public sync contains nested S3 before target DB or fake store access', () => {
    const s3TargetDir = mkdtempSync(join(tmpdir(), 'ok-sync-fake-s3-target-'));
    const s3TargetService = createKnowledgeService({ scope: 'project', cwd: s3TargetDir });
    const { workspace: s3Workspace } = configureS3Service(s3TargetService);
    const fakeS3Store = new FakeS3ArtifactStore('knowledge-bucket', 'org/project/knowledge');
    expect(() => s3TargetService.initDb()).toThrow('KNOWLEDGE_CONFIG_INVALID');
    expect(() => s3TargetService.storageContract()).toThrow('KNOWLEDGE_CONFIG_INVALID');
    expect(fakeS3Store.writes).toHaveLength(0);
    expect(existsSync(s3Workspace.knowledgeDbPath)).toBe(false);
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

    const resolvedPeerConflict = peerService.resolveSyncConflict({
      id: wikiConflict!.id,
      strategy: 'manual-merge',
      approveWrite: true,
      approvedBy: 'sync-test',
      proposedPatchUri: 'file:///tmp/reviewed-peer.patch',
    });
    expect(resolvedPeerConflict.ok).toBe(true);
    const repeatedPushPreview = await sourceService.syncPeer({ peerWorkspace: peerDir, direction: 'push', dryRun: true });
    expect(repeatedPushPreview.ok).toBe(true);
    const repeatedPushWiki = repeatedPushPreview.push?.tables.find((table) => table.table === 'wiki_pages');
    expect(repeatedPushWiki?.conflicts).toBe(0);
    expect(repeatedPushWiki?.skipped).toBe(1);

    const unchanged = openKnowledgeDb(peerService.paths().knowledge_db_path);
    try {
      const row = unchanged.query<{ title: string }, [string]>('SELECT title FROM wiki_pages WHERE path = ?').get('wiki/README.md');
      expect(row?.title).toBe('Peer edited README');
    } finally {
      unchanged.close();
    }

    const pull = await sourceService.syncPeer({ peerWorkspace: peerDir, direction: 'pull' });
    expect(pull.ok).toBe(false);
    expect(pull.pull?.tables.find((table) => table.table === 'wiki_pages')?.conflicts).toBe(1);
    const localConflict = sourceService.syncConflicts({ status: 'open' }).find((conflict) => conflict.entity_kind === 'wiki_pages');
    expect(localConflict).toBeTruthy();
    const resolvedLocalConflict = sourceService.resolveSyncConflict({
      id: localConflict!.id,
      strategy: 'manual-merge',
      approveWrite: true,
      approvedBy: 'sync-test',
      proposedPatchUri: 'file:///tmp/reviewed-local.patch',
    });
    expect(resolvedLocalConflict.ok).toBe(true);

    const finalPreview = await sourceService.syncPeer({ peerWorkspace: peerDir, direction: 'both', dryRun: true });
    expect(finalPreview.ok).toBe(true);
    expect(finalPreview.pull?.tables.find((table) => table.table === 'wiki_pages')?.conflicts).toBe(0);
    expect(finalPreview.push?.tables.find((table) => table.table === 'wiki_pages')?.conflicts).toBe(0);
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
