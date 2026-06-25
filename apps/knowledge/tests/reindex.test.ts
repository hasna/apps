import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getKnowledgeDbStats } from '../src/knowledge-db';
import { consumeOpenFilesOutbox } from '../src/outbox-consume';
import { enqueueMissingEmbeddings, refreshEmbeddingIndex, reindexHealth } from '../src/reindex';
import { hybridSearch } from '../src/search';
import { ingestSourceRef } from '../src/source-ingest';

describe('knowledge reindex queue and refresh jobs', () => {
  test('queues missing embeddings and refreshes incrementally or fully', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-reindex-'));
    const dbPath = join(dir, 'knowledge.db');
    const sourcePath = join(dir, 'source.md');
    writeFileSync(sourcePath, 'Reindex jobs should refresh semantic knowledge vectors.');
    const sourceRef = `file://${sourcePath}`;

    const ingest = await ingestSourceRef({
      dbPath,
      sourceRef,
      purpose: 'knowledge_index',
    });
    expect(ingest.chunks_inserted).toBe(1);

    const initial = reindexHealth({ dbPath, fake: true, dimensions: 8 });
    expect(initial.schema_version).toBe(8);
    expect(initial.chunks).toBe(1);
    expect(initial.vector_entries).toBe(0);
    expect(initial.missing_embeddings).toBe(1);
    expect(initial.queued.pending ?? 0).toBe(0);

    const enqueued = enqueueMissingEmbeddings({ dbPath, fake: true, dimensions: 8 });
    expect(enqueued.enqueued).toBe(1);
    expect(enqueued.already_queued).toBe(0);

    const duplicate = enqueueMissingEmbeddings({ dbPath, fake: true, dimensions: 8 });
    expect(duplicate.enqueued).toBe(0);
    expect(duplicate.already_queued).toBe(1);

    const queued = reindexHealth({ dbPath, fake: true, dimensions: 8 });
    expect(queued.queued.pending).toBe(1);

    const refreshed = await refreshEmbeddingIndex({ dbPath, fake: true, dimensions: 8 });
    expect(refreshed.full).toBe(false);
    expect(refreshed.queued.enqueued).toBe(0);
    expect(refreshed.queued.already_queued).toBe(1);
    expect(refreshed.indexed.chunks_embedded).toBe(1);
    expect(refreshed.indexed.vector_entries_upserted).toBe(1);
    expect(refreshed.completed_queue_items).toBe(1);

    const afterRefresh = reindexHealth({ dbPath, fake: true, dimensions: 8 });
    expect(afterRefresh.missing_embeddings).toBe(0);
    expect(afterRefresh.vector_entries).toBe(1);
    expect(afterRefresh.queued.completed).toBe(1);

    const full = await refreshEmbeddingIndex({ dbPath, full: true, fake: true, dimensions: 8 });
    expect(full.full).toBe(true);
    expect(full.deleted_embeddings).toBe(1);
    expect(full.deleted_vector_entries).toBe(1);
    expect(full.queued.enqueued).toBe(1);
    expect(full.indexed.vector_entries_upserted).toBe(1);
    expect(full.completed_queue_items).toBe(1);

    const stats = getKnowledgeDbStats(dbPath);
    expect(stats.vector_entries).toBe(1);
    expect(stats.reindex_queue).toBe(2);
    expect(stats.runs).toBe(2);
    expect(stats.run_events).toBe(2);
  });

  test('outbox content updates invalidate old chunks without previous revision', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-outbox-update-'));
    const dbPath = join(dir, 'knowledge.db');
    const sourcePath = join(dir, 'policy.md');
    writeFileSync(sourcePath, 'Old revision text should disappear after update invalidation.');
    const sourceRef = `file://${sourcePath}`;

    await ingestSourceRef({
      dbPath,
      sourceRef,
      purpose: 'knowledge_answer',
      now: new Date('2026-06-08T00:00:00.000Z'),
    });

    const before = await hybridSearch({
      dbPath,
      query: 'old revision text',
      limit: 5,
    });
    expect(before.results.some((result) => result.source?.uri === sourceRef)).toBe(true);

    const outbox = join(dir, 'outbox.jsonl');
    writeFileSync(outbox, JSON.stringify({
      event_type: 'file.updated',
      source_ref: sourceRef,
      revision: 'rev-2',
      updated_at: '2026-06-08T01:00:00.000Z',
    }));

    const consumed = await consumeOpenFilesOutbox({ dbPath, input: outbox });
    expect(consumed.events_seen).toBe(1);
    expect(consumed.chunks_deleted).toBe(1);
    expect(consumed.stale_revisions).toBe(2);

    const after = await hybridSearch({
      dbPath,
      query: 'old revision text',
      limit: 5,
    });
    expect(after.results.some((result) => result.source?.uri === sourceRef)).toBe(false);

    const stats = getKnowledgeDbStats(dbPath);
    expect(stats.chunks).toBe(0);
  });
});
