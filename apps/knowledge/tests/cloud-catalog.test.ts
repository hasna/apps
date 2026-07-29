import { describe, expect, test } from 'bun:test';
import { hybridSearchItems } from '../src/search';
import { retrieveKnowledgeContextFromItems } from '../src/retrieval';
import { runKnowledgePromptOverItems } from '../src/agent';
import type { KnowledgeItem } from '../src/store';

/**
 * Cloud (api) mode has NO local sqlite catalog — the shared corpus
 * is the cloud knowledge-items fetched through the item Store. These tests prove
 * that search / context / ask route over that in-memory item corpus and return
 * cited results instead of throwing (the pre-fix behaviour via assertLocalCatalogMode).
 */
const now = new Date().toISOString();
const CORPUS: KnowledgeItem[] = [
  {
    id: 'k_alpha',
    short_id: 'alpha',
    title: 'Deploy topology',
    content: 'The fleet deploys via ECS Fargate behind an ALB with RDS Postgres.',
    url: null,
    tags: ['infra'],
    metadata: {},
    archived: false,
    created_at: now,
    updated_at: now,
  },
  {
    id: 'k_beta',
    short_id: 'beta',
    title: 'Coffee notes',
    content: 'Unrelated content about espresso extraction.',
    url: null,
    tags: ['misc'],
    metadata: {},
    archived: false,
    created_at: now,
    updated_at: now,
  },
  {
    id: 'k_archived',
    short_id: 'arch',
    title: 'Old fargate doc',
    content: 'Archived fargate notes that must not surface.',
    url: null,
    tags: ['infra'],
    metadata: {},
    archived: true,
    created_at: now,
    updated_at: now,
  },
];

describe('cloud-mode catalog over the shared item corpus', () => {
  test('hybridSearchItems ranks matching non-archived items and skips archived', async () => {
    const result = await hybridSearchItems(CORPUS, { query: 'fargate' });
    const ids = result.results.map((r) => r.id);
    expect(ids).toContain('k_alpha');
    expect(ids).not.toContain('k_beta');
    expect(ids).not.toContain('k_archived');
    expect(result.results[0]?.kind).toBe('legacy_item');
  });

  test('semantic request over items reports semantic-unavailable rather than throwing', async () => {
    const result = await hybridSearchItems(CORPUS, { query: 'fargate', semantic: true }, ['seed']);
    expect(result.warnings).toContain('seed');
    expect(result.warnings).toContain('semantic_search_requires_local_catalog');
  });

  test('retrieveKnowledgeContextFromItems returns a cited context pack', async () => {
    const context = await retrieveKnowledgeContextFromItems(CORPUS, { query: 'ecs postgres' });
    expect(context.results.length).toBeGreaterThan(0);
    expect(context.results[0]?.id).toBe('k_alpha');
    expect(context.graph).toEqual({ citations: [], backlinks: [] });
  });

  test('runKnowledgePromptOverItems drafts a cited answer without a local db (dry-run)', async () => {
    const result = await runKnowledgePromptOverItems(CORPUS, { prompt: 'how does the fleet deploy?' });
    expect(result.generated).toBe(false);
    expect(result.provider).toBe('local');
    expect(result.answer).toContain('relevant knowledge excerpt');
    expect(result.context.results.map((r) => r.id)).toContain('k_alpha');
    expect(result.run_id.startsWith('run_')).toBe(true);
  });

  test('runKnowledgePromptOverItems supports fake generation client-side', async () => {
    const result = await runKnowledgePromptOverItems(CORPUS, {
      prompt: 'summarize deploy topology',
      generate: true,
      fake: true,
    });
    expect(result.generated).toBe(true);
    expect(result.answer.startsWith('Fake generated answer')).toBe(true);
  });
});
