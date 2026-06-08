import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runKnowledgePrompt } from '../src/agent';
import { hybridSearch } from '../src/search';
import { retrieveKnowledgeContext } from '../src/retrieval';
import {
  indexEvalCorpus,
  insertEvalWikiPage,
  patchChunkProvenance,
  seedEvalCorpus,
  seedSemanticFallbackCorpus,
} from './fixtures/semantic-eval-fixtures';

describe('semantic search and retrieval eval fixtures', () => {
  test('passes keyword, citation, rerank, and wiki retrieval eval cases', async () => {
    const corpus = await seedEvalCorpus();
    insertEvalWikiPage(corpus.dbPath, {
      path: 'wiki/onboarding.md',
      title: 'Onboarding',
      body: 'Onboarding durable knowledge page explains how agents should find handbook policy citations.',
      sourceRefs: [corpus.sources.handbook.sourceRef],
    });

    const keyword = await hybridSearch({
      dbPath: corpus.dbPath,
      query: 'paid time off approvals',
      limit: 5,
    });
    expect(keyword.results[0]).toMatchObject({
      kind: 'source_chunk',
      source: { uri: corpus.sources.handbook.sourceRef },
    });
    expect(keyword.results[0].reasons).toContain('keyword_match');

    const citationContext = await retrieveKnowledgeContext({
      dbPath: corpus.dbPath,
      query: 'manager approve pto payroll',
      limit: 5,
    });
    expect(citationContext.citations[0]).toMatchObject({
      source_uri: corpus.sources.handbook.sourceRef,
      source_ref: corpus.sources.handbook.sourceRef,
      revision: expect.stringContaining('sha256:'),
      hash: expect.stringContaining('sha256:'),
    });
    expect(citationContext.excerpts[0].text).toContain('Managers approve PTO requests');
    expect(citationContext.notes.permissions).toContain('All source-backed excerpts are read-only and citation-required.');

    const reranked = await retrieveKnowledgeContext({
      dbPath: corpus.dbPath,
      query: 'incident response escalation owner',
      limit: 5,
    });
    expect(reranked.results[0].source?.uri).toBe(corpus.sources.incident.sourceRef);
    expect(reranked.results[0].text).toContain('Incident response escalation owner');
    expect(reranked.results[0].rerank.final_score).toBeGreaterThan(reranked.results.at(-1)?.rerank.final_score ?? 0);

    const wiki = await hybridSearch({
      dbPath: corpus.dbPath,
      query: 'onboarding durable knowledge page',
      limit: 10,
    });
    expect(wiki.results.some((entry) => entry.kind === 'wiki_page' && entry.artifact?.path === 'wiki/onboarding.md')).toBe(true);
    expect(wiki.results.some((entry) => entry.kind === 'wiki_chunk' && entry.artifact?.path === 'wiki/onboarding.md')).toBe(true);
  });

  test('uses deterministic semantic fallback for synonym-style evals without network access', async () => {
    const corpus = await seedSemanticFallbackCorpus();
    const semantic = await hybridSearch({
      dbPath: corpus.dbPath,
      query: 'vacation benefit policy',
      semantic: true,
      fake: true,
      dimensions: 8,
      limit: 5,
    });

    expect(semantic.mode.semantic).toBe(true);
    expect(semantic.counts.keyword_results).toBe(0);
    expect(semantic.counts.semantic_results).toBe(1);
    expect(semantic.results[0]).toMatchObject({
      kind: 'source_chunk',
      source: { uri: corpus.sources.leaveSynonym.sourceRef },
    });
    expect(semantic.results[0].reasons).toContain('semantic_match');
  });

  test('filters stale revisions and non-read-only provenance before context assembly', async () => {
    const corpus = await seedEvalCorpus();
    await indexEvalCorpus(corpus);
    patchChunkProvenance(corpus.dbPath, corpus.sources.stale.sourceRef, {
      status: 'stale',
      stale: true,
    });
    patchChunkProvenance(corpus.dbPath, corpus.sources.private.sourceRef, {
      read_only: false,
    });

    const staleContext = await retrieveKnowledgeContext({
      dbPath: corpus.dbPath,
      query: 'deprecated vpn password rotation',
      limit: 5,
    });
    expect(staleContext.results.some((entry) => entry.source?.uri === corpus.sources.stale.sourceRef)).toBe(false);
    expect(staleContext.warnings.some((warning) => warning.startsWith('stale_filtered:'))).toBe(true);
    expect(staleContext.notes.freshness).toContain('Dropped a stale result whose source status requires reindexing.');

    const privateContext = await retrieveKnowledgeContext({
      dbPath: corpus.dbPath,
      query: 'private executive compensation plan',
      limit: 5,
    });
    expect(privateContext.results.some((entry) => entry.source?.uri === corpus.sources.private.sourceRef)).toBe(false);
    expect(privateContext.warnings.some((warning) => warning.startsWith('permission_filtered:'))).toBe(true);
    expect(privateContext.notes.permissions).toContain('Dropped a result because provenance was not read-only.');
  });

  test('covers missing-source prompt behavior and knowledge prompt context assembly', async () => {
    const emptyDbPath = join(mkdtempSync(join(tmpdir(), 'ok-empty-eval-')), 'knowledge.db');
    const missing = await runKnowledgePrompt({
      dbPath: emptyDbPath,
      prompt: 'What is the quantum coffee policy?',
      limit: 5,
    });
    expect(missing.context.excerpts).toHaveLength(0);
    expect(missing.citations).toHaveLength(0);
    expect(missing.answer).toContain('No indexed knowledge matched the prompt');

    const corpus = await seedEvalCorpus();
    const answer = await runKnowledgePrompt({
      dbPath: corpus.dbPath,
      prompt: 'How do managers approve PTO requests?',
      limit: 5,
    });
    expect(answer.generated).toBe(false);
    expect(answer.context.excerpts[0].text).toContain('Managers approve PTO requests');
    expect(answer.citations[0].source_uri).toBe(corpus.sources.handbook.sourceRef);
    expect(answer.answer).toContain(corpus.sources.handbook.sourceRef);
    expect(answer.proposed_wiki_updates[0]).toMatchObject({
      kind: 'answer_note',
      requires_approval: true,
    });
    expect(answer.write_policy.durable_writes_performed).toBe(false);
  });
});
