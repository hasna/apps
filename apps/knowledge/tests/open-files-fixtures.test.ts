import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildKnowledgeSyncFixturePack } from '../../open-files/src/lib/knowledge-sync-fixtures';
import { getKnowledgeDbStats, openKnowledgeDb } from '../src/knowledge-db';
import { ingestOpenFilesManifest } from '../src/manifest-ingest';
import { consumeOpenFilesOutbox } from '../src/outbox-consume';
import { resolveOpenFilesSource } from '../src/source-resolver';
import { retrieveKnowledgeContext } from '../src/retrieval';
import { createKnowledgeService } from '../src/service';

const KNOWLEDGE_TEXT_TABLES = [
  'sources',
  'source_revisions',
  'chunks',
  'chunks_fts',
  'runs',
  'run_events',
  'provider_usage',
  'redaction_findings',
  'storage_objects',
  'audit_events',
  'approval_gates',
  'vector_index_entries',
  'reindex_queue',
  'knowledge_machines',
  'knowledge_sync_snapshots',
  'knowledge_sync_changes',
  'knowledge_sync_conflicts',
  'knowledge_sync_table_clocks',
  'knowledge_sync_imports',
];

function readTextTree(root: string): string {
  if (!existsSync(root)) return '';
  let text = '';
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      text += readTextTree(path);
    } else if (stat.isFile()) {
      text += readFileSync(path, 'utf8');
    }
  }
  return text;
}

function dumpKnowledgeText(dbPath: string): string {
  const db = openKnowledgeDb(dbPath);
  try {
    const existing = new Set(db.query<{ name: string }, []>(
      `SELECT name
       FROM sqlite_master
       WHERE type IN ('table', 'view')`,
    ).all().map((row) => row.name));
    return KNOWLEDGE_TEXT_TABLES
      .filter((table) => existing.has(table))
      .map((table) => JSON.stringify({ table, rows: db.query(`SELECT * FROM ${table}`).all() }))
      .join('\n');
  } finally {
    db.close();
  }
}

function countRows(dbPath: string, table: string): number {
  const db = openKnowledgeDb(dbPath);
  try {
    const row = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get();
    return row?.n ?? 0;
  } finally {
    db.close();
  }
}

describe('open-files knowledge sync fixtures', () => {
  test('consume ACL, deletion, stale revision, extraction failure, duplicate hash, and rename fixtures safely', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-open-files-fixtures-'));
    const dbPath = join(dir, 'knowledge.db');
    const baselinePath = join(dir, 'baseline-manifest.jsonl');
    const currentPath = join(dir, 'current-manifest.jsonl');
    const outboxPath = join(dir, 'outbox.jsonl');
    const pack = buildKnowledgeSyncFixturePack();

    writeFileSync(baselinePath, pack.baseline_manifest_jsonl);
    writeFileSync(currentPath, pack.current_manifest_jsonl);
    writeFileSync(outboxPath, pack.outbox_jsonl);

    const baseline = await ingestOpenFilesManifest({ dbPath, input: baselinePath });
    expect(baseline.items_seen).toBe(pack.baseline_manifest.items.length);
    expect(baseline.chunks_inserted).toBe(pack.baseline_manifest.items.length);

    const duplicateRowsBefore = openKnowledgeDb(dbPath);
    try {
      const rows = duplicateRowsBefore.query<{ hash: string; n: number }, []>(
        `SELECT hash, COUNT(*) AS n
         FROM source_revisions
         WHERE hash = 'sha256:1111111111111111111111111111111111111111111111111111111111111111'
         GROUP BY hash`,
      ).all();
      expect(rows).toEqual([{ hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111', n: 2 }]);
    } finally {
      duplicateRowsBefore.close();
    }

    const invalidation = await consumeOpenFilesOutbox({ dbPath, input: outboxPath });
    expect(invalidation.events_seen).toBe(pack.outbox_events.length);
    expect(invalidation.chunks_deleted).toBe(4);
    expect(invalidation.deleted_sources).toBe(1);
    expect(invalidation.moved_sources).toBe(1);
    expect(invalidation.permission_updates).toBe(1);

    const afterInvalidation = await retrieveKnowledgeContext({
      dbPath,
      query: 'delete-me confidential brief old-name survive',
      limit: 10,
      semantic: false,
    });
    expect(afterInvalidation.results.filter((result) => result.kind === 'source_chunk')).toHaveLength(0);
    expect(afterInvalidation.citations).toHaveLength(0);
    expect(JSON.stringify({
      results: afterInvalidation.results,
      citations: afterInvalidation.citations,
      excerpts: afterInvalidation.excerpts,
    })).not.toContain('confidential brief');
    expect(JSON.stringify({
      results: afterInvalidation.results,
      citations: afterInvalidation.citations,
      excerpts: afterInvalidation.excerpts,
    })).not.toContain('Deleted source fixture text');

    await expect(resolveOpenFilesSource({
      dbPath,
      sourceRef: 'open-files://file/f_fixture_acl/revision/rev_fixture_acl_before',
      purpose: 'knowledge_index',
    })).rejects.toThrow('Purpose is explicitly denied');

    const current = await ingestOpenFilesManifest({ dbPath, input: currentPath });
    expect(current.items_seen).toBe(pack.current_manifest.items.length);
    expect(current.chunks_inserted).toBe(4);
    expect(current.skipped).toBe(0);

    const stats = getKnowledgeDbStats(dbPath);
    expect(stats.chunks).toBe(4);

    const staleContext = await retrieveKnowledgeContext({
      dbPath,
      query: 'delete-me confidential brief survive',
      limit: 10,
      semantic: false,
    });
    expect(staleContext.results.filter((result) => result.kind === 'source_chunk')).toHaveLength(0);
    expect(staleContext.citations).toHaveLength(0);
    expect(JSON.stringify({
      results: staleContext.results,
      citations: staleContext.citations,
      excerpts: staleContext.excerpts,
    })).not.toContain('confidential brief');
    expect(JSON.stringify({
      results: staleContext.results,
      citations: staleContext.citations,
      excerpts: staleContext.excerpts,
    })).not.toContain('Deleted source fixture text');

    const freshContext = await retrieveKnowledgeContext({
      dbPath,
      query: 'replacement policy current path duplicate alpha beta',
      limit: 10,
      semantic: false,
    });
    expect(freshContext.results.length).toBeGreaterThanOrEqual(3);
    expect(freshContext.results.some((result) => result.source?.uri === 'open-files://file/f_fixture_stale')).toBe(true);
    expect(freshContext.results.some((result) => result.source?.uri === 'open-files://file/f_fixture_renamed')).toBe(true);
    expect(freshContext.citations.every((citation) => citation.source_uri?.startsWith('open-files://file/'))).toBe(true);
    expect(JSON.stringify(freshContext)).not.toContain('confidential brief');
    expect(JSON.stringify(freshContext)).not.toContain('Deleted source fixture text');
  });

  test('syncs open-files source refs and invalidations without copying raw source bytes', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'ok-open-files-sync-source-'));
    const peerDir = mkdtempSync(join(tmpdir(), 'ok-open-files-sync-peer-'));
    const sourceService = createKnowledgeService({ scope: 'project', cwd: sourceDir });
    const peerService = createKnowledgeService({ scope: 'project', cwd: peerDir });
    sourceService.initDb();
    peerService.initDb();

    const sourcePaths = sourceService.paths();
    const peerPaths = peerService.paths();
    const pack = buildKnowledgeSyncFixturePack();
    const baselinePath = join(sourceDir, 'baseline-manifest.jsonl');
    const currentPath = join(sourceDir, 'current-manifest.jsonl');
    const outboxPath = join(sourceDir, 'outbox.jsonl');
    const rawSentinel = 'RAW_BYTE_SENTINEL_SHOULD_STAY_IN_OPEN_FILES_20260609';
    const rawSentinelBase64 = Buffer.from(rawSentinel, 'utf8').toString('base64');
    const extractedSummary = 'Raw boundary fixture extracted summary. This indexed summary is allowed in knowledge.';
    const rawGuardItem = {
      source_ref: 'open-files://file/f_fixture_raw_guard',
      revision_ref: 'open-files://file/f_fixture_raw_guard/revision/rev_fixture_raw_guard',
      file_id: 'f_fixture_raw_guard',
      source_id: 'src_fixture_drive',
      revision_id: 'rev_fixture_raw_guard',
      path: 'google-drive/example/shared-drive/security/raw-guard.md',
      name: 'raw-guard.md',
      mime: 'text/markdown',
      size: rawSentinel.length,
      hash: 'sha256:8888888888888888888888888888888888888888888888888888888888888888',
      status: 'active',
      updated_at: '2026-06-09T00:00:00.000Z',
      permissions: {
        mode: 'read_only',
        allowed_purposes: ['knowledge_index', 'knowledge_answer', 'agent_context'],
      },
      storage: {
        provider: 's3',
        bucket: 'example-files-prod',
        key: 'fixtures/knowledge-sync/raw-guard/rev_fixture_raw_guard',
      },
      metadata: {
        kept_marker: 'safe_open_files_metadata',
        raw_bytes: rawSentinel,
        nested: {
          kept_nested_marker: 'safe_nested_metadata',
          content_base64: rawSentinelBase64,
        },
      },
      raw_bytes: rawSentinel,
      raw_content: rawSentinel,
      source_content: rawSentinel,
      content_base64: rawSentinelBase64,
      extracted_text: extractedSummary,
    };

    writeFileSync(baselinePath, pack.baseline_manifest_jsonl);
    await ingestOpenFilesManifest({ dbPath: sourcePaths.knowledge_db_path, input: baselinePath });
    const baselinePush = await sourceService.syncPeer({
      peerWorkspace: peerDir,
      direction: 'push',
      machineId: 'linux-node-b-fixture',
    });
    expect(baselinePush.ok).toBe(true);
    expect(countRows(peerPaths.knowledge_db_path, 'chunks')).toBe(pack.baseline_manifest.items.length);
    expect(countRows(peerPaths.knowledge_db_path, 'chunks_fts')).toBe(pack.baseline_manifest.items.length);

    writeFileSync(outboxPath, pack.outbox_jsonl);
    await consumeOpenFilesOutbox({ dbPath: sourcePaths.knowledge_db_path, input: outboxPath });
    writeFileSync(
      currentPath,
      pack.current_manifest_jsonl + JSON.stringify(rawGuardItem) + '\n',
    );
    await ingestOpenFilesManifest({ dbPath: sourcePaths.knowledge_db_path, input: currentPath });

    const currentPush = await sourceService.syncPeer({
      peerWorkspace: peerDir,
      direction: 'push',
      machineId: 'linux-node-b-fixture',
    });
    expect(currentPush.ok).toBe(true);
    const chunkSync = currentPush.push?.tables.find((table) => table.table === 'chunks');
    expect(chunkSync?.deleted).toBe(4);
    expect(countRows(peerPaths.knowledge_db_path, 'chunks')).toBe(5);
    expect(countRows(peerPaths.knowledge_db_path, 'chunks_fts')).toBe(5);

    const peerContext = await retrieveKnowledgeContext({
      dbPath: peerPaths.knowledge_db_path,
      query: 'raw boundary replacement policy current path duplicate alpha beta',
      limit: 10,
      semantic: false,
    });
    const peerContextText = JSON.stringify(peerContext);
    expect(peerContextText).toContain(extractedSummary);
    expect(peerContextText).not.toContain(rawSentinel);
    expect(peerContextText).not.toContain(rawSentinelBase64);
    expect(peerContextText).not.toContain('confidential brief');
    expect(peerContextText).not.toContain('Deleted source fixture text');
    expect(peerContextText).not.toContain('Stale revision fixture old policy text');
    expect(peerContextText).not.toContain('Renamed path fixture old path text');
    expect(peerContext.citations.every((citation) => citation.source_uri?.startsWith('open-files://file/'))).toBe(true);

    const sourceKnowledgeText = dumpKnowledgeText(sourcePaths.knowledge_db_path) + readTextTree(sourcePaths.artifacts_dir);
    const peerKnowledgeText = dumpKnowledgeText(peerPaths.knowledge_db_path) + readTextTree(peerPaths.artifacts_dir);
    expect(sourceKnowledgeText).not.toContain(rawSentinel);
    expect(sourceKnowledgeText).not.toContain(rawSentinelBase64);
    expect(peerKnowledgeText).not.toContain(rawSentinel);
    expect(peerKnowledgeText).not.toContain(rawSentinelBase64);
    expect(peerKnowledgeText).toContain('safe_open_files_metadata');
    expect(peerKnowledgeText).toContain('safe_nested_metadata');
  });
});
