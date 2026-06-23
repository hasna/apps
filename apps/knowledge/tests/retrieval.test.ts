import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openKnowledgeDb } from '../src/knowledge-db';
import { retrieveKnowledgeContext } from '../src/retrieval';
import { ingestSourceRef } from '../src/source-ingest';

describe('knowledge retrieval context packs', () => {
  test('assembles context excerpts from legacy JSON notes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-retrieval-legacy-note-'));
    const dbPath = join(dir, 'knowledge.db');
    const legacyStorePath = join(dir, 'db.json');
    writeFileSync(legacyStorePath, JSON.stringify({
      items: [{
        id: 'k_note_context',
        title: 'Hasna OSS boundary',
        content: 'local-first hosted wrapper open actions guardrails open orgs',
        url: null,
        tags: ['opensource'],
        created_at: '2026-06-23T00:00:00.000Z',
        updated_at: '2026-06-23T00:01:00.000Z',
      }],
    }));

    const context = await retrieveKnowledgeContext({
      dbPath,
      legacyStorePath,
      query: 'local-first hosted wrapper open actions guardrails open orgs',
      limit: 5,
    });

    expect(context.results[0]).toMatchObject({
      kind: 'legacy_item',
      id: 'k_note_context',
      source: { ref: 'knowledge://item/k_note_context' },
    });
    expect(context.citations[0]).toMatchObject({
      kind: 'legacy_item',
      source_uri: 'knowledge://item/k_note_context',
      chunk_id: null,
    });
    expect(context.excerpts[0].text).toContain('local-first hosted wrapper');
  });

  test('reranks search results and assembles citations, excerpts, and graph evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-retrieval-'));
    const dbPath = join(dir, 'knowledge.db');
    const source = join(dir, 'source.md');
    writeFileSync(source, 'Retrieval context should cite company handbook source evidence.');
    const sourceRef = `file://${source}`;

    await ingestSourceRef({ dbPath, sourceRef, purpose: 'knowledge_index' });
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
  });
});
