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
  test('searches source chunks, wiki chunks, catalog rows, and optional vectors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-hybrid-search-'));
    const dbPath = join(dir, 'knowledge.db');
    const source = join(dir, 'handbook.md');
    writeFileSync(source, 'Company handbook policy explains source-governed wiki search.');
    const sourceRef = `file://${source}`;

    await ingestSourceRef({
      dbPath,
      sourceRef,
      purpose: 'knowledge_answer',
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

  test('filters source chunks outside the requested purpose', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-hybrid-purpose-'));
    const dbPath = join(dir, 'knowledge.db');
    const source = join(dir, 'index-only.md');
    writeFileSync(source, 'Index-only material should not appear in answer retrieval.');
    const sourceRef = `file://${source}`;

    await ingestSourceRef({
      dbPath,
      sourceRef,
      purpose: 'knowledge_index',
    });

    const answerSearch = await hybridSearch({
      dbPath,
      query: 'index-only material',
      limit: 5,
    });
    expect(answerSearch.results.some((result) => result.source?.uri === sourceRef)).toBe(false);
    expect(answerSearch.warnings.some((warning) => warning.startsWith('purpose_not_allowed:'))).toBe(true);

    const indexSearch = await hybridSearch({
      dbPath,
      query: 'index-only material',
      purpose: 'knowledge_index',
      limit: 5,
    });
    expect(indexSearch.results.some((result) => result.source?.uri === sourceRef)).toBe(true);
  });

  test('filters expired wiki pages from catalog and FTS results', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-hybrid-expired-wiki-'));
    const dbPath = join(dir, 'knowledge.db');
    const store = new LocalArtifactStore(join(dir, 'artifacts'));
    const wiki = await initializeWikiLayout(store, new Date('2026-06-08T00:00:00.000Z'));
    migrateKnowledgeDb(dbPath);
    const db = openKnowledgeDb(dbPath);
    try {
      recordWikiLayoutCatalog(db, wiki.artifacts, new Date('2026-06-08T00:00:00.000Z'));
      db.run(
        'UPDATE wiki_pages SET valid_to = ?, updated_at = ? WHERE path = ?',
        '2000-01-01T00:00:00.000Z',
        '2026-06-09T00:00:00.000Z',
        'wiki/README.md',
      );
    } finally {
      db.close();
    }

    const results = await hybridSearch({
      dbPath,
      query: 'Generated durable knowledge pages',
      limit: 10,
    });

    expect(results.results.some((result) => result.kind === 'wiki_chunk')).toBe(false);
    expect(results.results.some((result) => result.kind === 'wiki_page')).toBe(false);
  });
});
