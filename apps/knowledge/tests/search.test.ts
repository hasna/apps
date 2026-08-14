import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalArtifactStore } from '../src/artifact-store';
import { indexKnowledgeEmbeddings } from '../src/embeddings';
import { migrateKnowledgeDb, openKnowledgeDb } from '../src/knowledge-db';
import { hybridSearch } from '../src/search';
import { ingestSourceRef } from '../src/source-ingest';
import { initializeWikiLayout, recordWikiLayoutCatalog } from '../src/wiki-layout';

describe('hybrid knowledge search', () => {
  test('searches active legacy JSON notes as keyword results', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-hybrid-legacy-notes-'));
    const dbPath = join(dir, 'knowledge.db');
    const legacyStorePath = join(dir, 'db.json');
    writeFileSync(legacyStorePath, JSON.stringify({
      items: [
        {
          id: 'k_note_boundary',
          title: 'Hasna OSS boundary',
          content: 'local-first hosted wrapper open actions guardrails open orgs',
          url: null,
          tags: ['opensource'],
          created_at: '2026-06-23T00:00:00.000Z',
          updated_at: '2026-06-23T00:01:00.000Z',
        },
        {
          id: 'k_archived_note',
          title: 'Archived boundary',
          content: 'This archived note should not be returned.',
          url: null,
          tags: ['opensource'],
          archived: true,
          created_at: '2026-06-23T00:00:00.000Z',
          updated_at: '2026-06-23T00:01:00.000Z',
        },
      ],
    }));

    const results = await hybridSearch({
      dbPath,
      legacyStorePath,
      query: 'Hasna OSS boundary',
      limit: 5,
    });

    expect(results.counts.keyword_results).toBe(1);
    expect(results.results).toHaveLength(1);
    expect(results.results[0]).toMatchObject({
      kind: 'legacy_item',
      id: 'k_note_boundary',
      title: 'Hasna OSS boundary',
      text: 'local-first hosted wrapper open actions guardrails open orgs',
      source: {
        uri: 'knowledge://item/k_note_boundary',
        kind: 'legacy_item',
      },
      reasons: ['legacy_note_match', 'keyword_match'],
    });
  });

  test('searches source chunks, wiki chunks, catalog rows, and optional vectors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-hybrid-search-'));
    const dbPath = join(dir, 'knowledge.db');
    const source = join(dir, 'handbook.md');
    writeFileSync(source, 'Company handbook policy explains source-governed wiki search.');
    const sourceRef = `file://${source}`;

    await ingestSourceRef({
      dbPath,
      sourceRef,
      purpose: 'knowledge_index',
    });

    const store = new LocalArtifactStore(join(dir, 'artifacts'));
    const wiki = await initializeWikiLayout(store, new Date('2026-06-08T00:00:00.000Z'));
    const db = openKnowledgeDb(dbPath);
    try {
      recordWikiLayoutCatalog(db, wiki.artifacts, new Date('2026-06-08T00:00:00.000Z'));
    } finally {
      db.close();
    }

    const sourceSearch = await hybridSearch({
      dbPath,
      query: 'handbook policy',
      limit: 5,
    });
    expect(sourceSearch.mode.semantic).toBe(false);
    expect(sourceSearch.results[0]).toMatchObject({
      kind: 'source_chunk',
      source: { uri: sourceRef },
      citation: { start_offset: 0 },
    });
    expect(sourceSearch.results[0].provenance).toMatchObject({
      source_owner: 'open-files',
      source_uri: sourceRef,
      read_only: true,
    });

    const wikiSearch = await hybridSearch({
      dbPath,
      query: 'durable knowledge pages',
      limit: 10,
    });
    expect(wikiSearch.results.some((result) => result.kind === 'wiki_chunk' && result.artifact?.path === 'wiki/README.md')).toBe(true);
    expect(wikiSearch.results.some((result) => result.kind === 'wiki_page' && result.artifact?.path === 'wiki/README.md')).toBe(true);

    const indexed = await indexKnowledgeEmbeddings({
      dbPath,
      fake: true,
      dimensions: 8,
      limit: 10,
    });
    expect(indexed.vector_entries_upserted).toBeGreaterThanOrEqual(2);

    const semantic = await hybridSearch({
      dbPath,
      query: 'source governed wiki search',
      semantic: true,
      fake: true,
      dimensions: 8,
      limit: 5,
    });
    expect(semantic.mode.semantic).toBe(true);
    expect(semantic.counts.semantic_results).toBeGreaterThan(0);
    expect(semantic.results.some((result) => result.reasons.includes('semantic_match'))).toBe(true);

    migrateKnowledgeDb(dbPath);
  });
});
