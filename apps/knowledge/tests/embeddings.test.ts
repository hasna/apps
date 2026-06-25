import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexKnowledgeEmbeddings, searchVectorIndex, embeddingIndexStatus } from '../src/embeddings';
import { getKnowledgeDbStats } from '../src/knowledge-db';
import { consumeOpenFilesOutbox } from '../src/outbox-consume';
import { ingestSourceRef } from '../src/source-ingest';

describe('knowledge embeddings and vector index', () => {
  test('indexes chunks with deterministic embeddings and searches with provenance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-embeddings-'));
    const dbPath = join(dir, 'knowledge.db');
    const source = join(dir, 'source.md');
    const outbox = join(dir, 'outbox.jsonl');
    writeFileSync(source, 'Semantic indexing should find this chunk about company wiki search.');
    const sourceRef = `file://${source}`;

    const ingest = await ingestSourceRef({
      dbPath,
      sourceRef,
      purpose: 'knowledge_index',
    });
    expect(ingest.chunks_inserted).toBe(1);
    expect(embeddingIndexStatus(dbPath).total_vector_entries).toBe(0);

    const indexed = await indexKnowledgeEmbeddings({
      dbPath,
      fake: true,
      dimensions: 8,
      limit: 10,
    });
    expect(indexed).toMatchObject({
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 8,
      chunks_seen: 1,
      chunks_embedded: 1,
      embeddings_upserted: 1,
      vector_entries_upserted: 1,
    });

    const stats = getKnowledgeDbStats(dbPath);
    expect(stats.embeddings).toBe(1);
    expect(stats.vector_entries).toBe(1);
    expect(embeddingIndexStatus(dbPath).indexes[0]).toMatchObject({
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 8,
      entries: 1,
    });

    const search = await searchVectorIndex({
      dbPath,
      query: 'company wiki semantic search',
      fake: true,
      dimensions: 8,
      limit: 5,
      purpose: 'knowledge_index',
    });
    expect(search.results).toHaveLength(1);
    expect(search.results[0].text).toContain('Semantic indexing');
    expect(search.results[0].provenance).toMatchObject({
      source_owner: 'open-files',
      source_uri: sourceRef,
      source_kind: 'file',
      read_only: true,
      citation_required: true,
    });

    writeFileSync(outbox, `${JSON.stringify({
      event: 'deleted',
      source_ref: sourceRef,
      status: 'deleted',
      hash: ingest.hash,
      updated_at: '2026-06-08T00:00:00.000Z',
    })}\n`);
    const invalidated = await consumeOpenFilesOutbox({ dbPath, input: outbox });
    expect(invalidated.chunks_deleted).toBe(1);
    expect(invalidated.embeddings_deleted).toBe(1);
    expect(invalidated.vector_entries_deleted).toBe(1);
    expect(getKnowledgeDbStats(dbPath).vector_entries).toBe(0);
  });
});
