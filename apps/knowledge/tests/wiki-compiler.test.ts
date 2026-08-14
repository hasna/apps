import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalArtifactStore } from '../src/artifact-store';
import { getKnowledgeDbStats, openKnowledgeDb } from '../src/knowledge-db';
import { compileWikiPage, fileAnswerToWiki, lintWiki } from '../src/wiki-compiler';
import { retrieveKnowledgeContext } from '../src/retrieval';
import { ingestSourceRef } from '../src/source-ingest';

describe('wiki compile, answer filing, and lint loops', () => {
  test('compiles source chunks into cited wiki pages, indexes, logs, and backlinks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-wiki-compile-'));
    const dbPath = join(dir, 'knowledge.db');
    const source = join(dir, 'handbook.md');
    writeFileSync(source, 'Wiki compile should cite handbook source chunks for durable company knowledge.');
    const sourceRef = `file://${source}`;
    await ingestSourceRef({ dbPath, sourceRef, purpose: 'knowledge_index' });

    const result = await compileWikiPage({
      dbPath,
      store: new LocalArtifactStore(join(dir, 'artifacts')),
      title: 'Handbook Policy',
      query: 'handbook source chunks',
      now: new Date('2026-06-08T00:00:00.000Z'),
    });

    expect(result.path).toBe('wiki/generated/handbook-policy.md');
    expect(result.chunks_seen).toBe(1);
    expect(result.citations_written).toBe(1);
    expect(result.concept_page_id).toStartWith('wiki_');
    expect(result.indexes_updated).toBe(1);
    expect(result.log_key).toBe('logs/2026/06/08.jsonl');

    const db = openKnowledgeDb(dbPath);
    try {
      const page = db.query<{ title: string; artifact_uri: string }, [string]>(
        'SELECT title, artifact_uri FROM wiki_pages WHERE path = ?',
      ).get(result.path);
      expect(page?.title).toBe('Handbook Policy');
      expect(page?.artifact_uri).toContain('/wiki/generated/handbook-policy.md');
      expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM citations').get()?.n).toBe(1);
      expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM wiki_backlinks').get()?.n).toBe(1);
      expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM knowledge_indexes WHERE kind = "wiki_topic"').get()?.n).toBe(1);
    } finally {
      db.close();
    }

    const lint = lintWiki({ dbPath });
    expect(lint.issues.some((issue) => issue.type === 'missing_citation')).toBe(false);
    expect(lint.counts.citations).toBe(1);

    const stats = getKnowledgeDbStats(dbPath);
    expect(stats.wiki_pages).toBe(2);
    expect(stats.storage_objects).toBe(3);
  });

  test('files approved answers and keeps unapproved answer filing as dry run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-wiki-answer-'));
    const dbPath = join(dir, 'knowledge.db');
    const source = join(dir, 'source.md');
    writeFileSync(source, 'Answer filing should cite handbook evidence before durable wiki writes.');
    const sourceRef = `file://${source}`;
    await ingestSourceRef({ dbPath, sourceRef, purpose: 'knowledge_index' });
    const context = await retrieveKnowledgeContext({
      dbPath,
      query: 'handbook evidence',
      limit: 5,
    });

    const dryRun = await fileAnswerToWiki({
      dbPath,
      store: new LocalArtifactStore(join(dir, 'artifacts')),
      prompt: 'How should answer filing cite evidence?',
      answer: 'Use the cited handbook evidence.',
      context,
    });
    expect(dryRun.durable_writes_performed).toBe(false);
    expect(dryRun.page_id).toBeNull();

    const filed = await fileAnswerToWiki({
      dbPath,
      store: new LocalArtifactStore(join(dir, 'artifacts')),
      prompt: 'How should answer filing cite evidence?',
      answer: 'Use the cited handbook evidence.',
      context,
      approveWrite: true,
      now: new Date('2026-06-08T00:00:00.000Z'),
    });
    expect(filed.durable_writes_performed).toBe(true);
    expect(filed.path).toBe('wiki/answers/how-should-answer-filing-cite-evidence.md');
    expect(filed.citations_written).toBe(1);
    expect(filed.artifact_uri).toContain('/wiki/answers/how-should-answer-filing-cite-evidence.md');
  });

  test('lint reports missing citations, stale citations, duplicate pages, and new article candidates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-wiki-lint-'));
    const dbPath = join(dir, 'knowledge.db');
    const source = join(dir, 'lint-source.md');
    writeFileSync(source, 'Lint source chunk should become a new article candidate.');
    await ingestSourceRef({ dbPath, sourceRef: `file://${source}`, purpose: 'knowledge_index' });

    const db = openKnowledgeDb(dbPath);
    try {
      db.run(
        `INSERT INTO wiki_pages (id, path, title, artifact_uri, content_hash, status, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['wiki_missing', 'wiki/generated/missing.md', 'Duplicate', 'file:///missing.md', 'sha256:missing', 'active', '{}', '2026-06-08T00:00:00.000Z', '2026-06-08T00:00:00.000Z'],
      );
      db.run(
        `INSERT INTO wiki_pages (id, path, title, artifact_uri, content_hash, status, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['wiki_duplicate', 'wiki/generated/duplicate.md', 'Duplicate', 'file:///duplicate.md', 'sha256:duplicate', 'active', '{}', '2026-06-08T00:00:00.000Z', '2026-06-08T00:00:00.000Z'],
      );
      const chunk = db.query<{ id: string; metadata_json: string }, []>('SELECT id, metadata_json FROM chunks WHERE kind = "source" LIMIT 1').get();
      expect(chunk?.id).toStartWith('chk_');
      const metadata = JSON.parse(chunk?.metadata_json ?? '{}');
      metadata.provenance = { ...(metadata.provenance ?? {}), status: 'stale', stale: true };
      db.run('UPDATE chunks SET metadata_json = ? WHERE id = ?', [JSON.stringify(metadata), chunk?.id]);
      db.run(
        `INSERT INTO citations (id, wiki_page_id, chunk_id, source_uri, quote, start_offset, end_offset, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['cit_stale', 'wiki_duplicate', chunk?.id, `file://${source}`, 'stale quote', 0, 12, '{}', '2026-06-08T00:00:00.000Z'],
      );
    } finally {
      db.close();
    }

    const lint = lintWiki({ dbPath });
    expect(lint.ok).toBe(false);
    expect(lint.issues.some((issue) => issue.type === 'missing_citation')).toBe(true);
    expect(lint.issues.some((issue) => issue.type === 'stale_citation')).toBe(true);
    expect(lint.issues.some((issue) => issue.type === 'duplicate_page')).toBe(true);
    expect(lint.issues.some((issue) => issue.type === 'new_article_candidate')).toBe(false);
  });
});
