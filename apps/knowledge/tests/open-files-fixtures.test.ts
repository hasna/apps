import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildKnowledgeSyncFixturePack } from '../../open-files/src/lib/knowledge-sync-fixtures';
import { getKnowledgeDbStats, openKnowledgeDb } from '../src/knowledge-db';
import { ingestOpenFilesManifest } from '../src/manifest-ingest';
import { consumeOpenFilesOutbox } from '../src/outbox-consume';
import { resolveOpenFilesSource } from '../src/source-resolver';
import { retrieveKnowledgeContext } from '../src/retrieval';

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
});
