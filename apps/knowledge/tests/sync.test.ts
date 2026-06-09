import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect(status.sqlite_schema_version).toBe(6);
    expect(status.machines.total).toBe(2);
    expect(status.snapshots.total).toBe(1);
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
    expect(peerService.syncConflicts({ status: 'open' }).some((conflict) => conflict.entity_kind === 'wiki_pages')).toBe(true);

    const unchanged = openKnowledgeDb(peerService.paths().knowledge_db_path);
    try {
      const row = unchanged.query<{ title: string }, [string]>('SELECT title FROM wiki_pages WHERE path = ?').get('wiki/README.md');
      expect(row?.title).toBe('Peer edited README');
    } finally {
      unchanged.close();
    }
  });
});
