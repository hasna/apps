import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openKnowledgeDb } from '../src/knowledge-db';
import { retrieveKnowledgeContext } from '../src/retrieval';
import { ingestSourceRef } from '../src/source-ingest';

describe('knowledge retrieval context packs', () => {
  test('reranks search results and assembles citations, excerpts, and graph evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-retrieval-'));
    const dbPath = join(dir, 'knowledge.db');
    const source = join(dir, 'source.md');
    writeFileSync(source, 'Retrieval context should cite company handbook source evidence.');
    const sourceRef = `file://${source}`;

    await ingestSourceRef({ dbPath, sourceRef, purpose: 'knowledge_answer' });
    const db = openKnowledgeDb(dbPath);
    try {
      const chunk = db.query<{ id: string }, []>('SELECT id FROM chunks LIMIT 1').get();
      expect(chunk?.id).toStartWith('chk_');
      db.run(
        `INSERT INTO citations (id, chunk_id, source_uri, quote, start_offset, end_offset, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'cit_test',
          chunk?.id,
          sourceRef,
          'company handbook source evidence',
          30,
          62,
          '{}',
          '2026-06-08T00:00:00.000Z',
        ],
      );
    } finally {
      db.close();
    }

    const context = await retrieveKnowledgeContext({
      dbPath,
      query: 'company handbook evidence',
      limit: 5,
    });

    expect(context.normalized_query).toBe('company handbook evidence');
    expect(context.results[0].rerank.final_score).toBe(context.results[0].score);
    expect(context.results[0].reasons).toContain('cited_source');
    expect(context.citations[0]).toMatchObject({
      source_uri: sourceRef,
      source_ref: sourceRef,
      chunk_id: context.results[0].id,
    });
    expect(context.excerpts[0].text).toContain('Retrieval context');
    expect(context.graph.citations[0]).toMatchObject({
      id: 'cit_test',
      source_uri: sourceRef,
    });
    expect(context.notes.permissions).toContain('All source-backed excerpts are read-only and citation-required.');
    expect(context.notes.stability).toContain('Context evidence order is deterministic by final score and stable result id.');
  });
});
