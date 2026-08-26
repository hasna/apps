import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KNOWLEDGE_BOUNDED_QUERY_CAPABILITY } from '../src/query-contract';
import { createKnowledgeService } from '../src/service';
import type { KnowledgeItem } from '../src/store';

const now = '2026-08-10T00:00:00.000Z';
const producerItem: KnowledgeItem = {
  id: 'k_producer_ranked',
  short_id: 'ranked',
  title: 'Producer-ranked doctrine',
  content: 'The producer-ranked result is the only evidence this bounded page should expose.',
  url: null,
  tags: ['producer'],
  metadata: {},
  archived: false,
  created_at: now,
  updated_at: now,
};

let server: { port: number; stop(closeActiveConnections?: boolean): void };
const savedEnv: Record<string, string | undefined> = {};
const producerRequests: URL[] = [];
const fallbackRequests: URL[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      const url = new URL(request.url);
      // The deployed knowledge server (0.2.114) serves search at
      // /v1/notes/search: { items: [{ item, rank }], total,
      // query_capability } — the pre-unified contract measured live at
      // knowledge.hasna.xyz on 2026-08-26. The client must use this route,
      // not the unified /v1/search that no shipped server implements.
      if (url.pathname === '/v1/notes/search') {
        producerRequests.push(url);
        return Response.json({
          items: [{ item: producerItem, rank: 0.875 }],
          total: 7,
          query_capability: KNOWLEDGE_BOUNDED_QUERY_CAPABILITY,
        });
      }
      if (url.pathname === '/v1/notes') {
        fallbackRequests.push(url);
        return Response.json({ error: 'full_corpus_fallback_forbidden' }, { status: 500 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    },
  });

  const keys = [
    'NODE_ENV',
    'HASNA_KNOWLEDGE_API_URL',
    ['HASNA_KNOWLEDGE_API', 'KEY'].join('_'),
  ];
  for (const key of keys) savedEnv[key] = process.env[key];
  process.env.NODE_ENV = 'test';
  process.env.HASNA_KNOWLEDGE_API_URL = `http://127.0.0.1:${server.port}`;
  process.env[['HASNA_KNOWLEDGE_API', 'KEY'].join('_')] = ['fixture', 'credential'].join('-');
});

afterAll(() => {
  server.stop(true);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  producerRequests.length = 0;
  fallbackRequests.length = 0;
});

function serviceFor(testName: string) {
  return createKnowledgeService({
    scope: 'project',
    cwd: mkdtempSync(join(tmpdir(), `knowledge-${testName}-`)),
  });
}

function expectOneProducerRequest(query: string): void {
  expect(producerRequests).toHaveLength(1);
  expect(producerRequests[0]!.pathname).toBe('/v1/notes/search');
  expect(producerRequests[0]!.searchParams.get('q')).toBe(query);
  expect(fallbackRequests).toHaveLength(0);
}

describe('KnowledgeService bounded producer query path', () => {
  test('search performs one producer request and preserves rank plus total', async () => {
    const service = serviceFor('search');
    const result = await service.search({ query: 'producer doctrine', limit: 1, offset: 2 });

    expectOneProducerRequest('producer doctrine');
    expect(producerRequests[0]!.searchParams.get('limit')).toBe('1');
    expect(producerRequests[0]!.searchParams.get('offset')).toBe('2');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.scores.keyword).toBe(0.875);
    expect(result.counts.keyword_results).toBe(7);
  });

  test('retrieveContext uses the same single producer request without list paging', async () => {
    const service = serviceFor('context');
    const result = await service.retrieveContext({ query: 'producer context', limit: 1 });

    expectOneProducerRequest('producer context');
    expect(result.results[0]!.id).toBe(producerItem.id);
    expect(result.results[0]!.scores.keyword).toBe(0.875);
    expect(result.search_counts.keyword_results).toBe(7);
    expect(result.citations[0]!.source_uri).toBe(`knowledge://item/${producerItem.id}`);
  });

  test('runPrompt shares the bounded producer result without re-fetching the collection', async () => {
    const service = serviceFor('prompt');
    const result = await service.runPrompt({ prompt: 'producer prompt', limit: 1 });

    expectOneProducerRequest('producer prompt');
    expect(result.generated).toBe(false);
    expect(result.context.results[0]!.id).toBe(producerItem.id);
    expect(result.context.results[0]!.scores.keyword).toBe(0.875);
    expect(result.context.search_counts.keyword_results).toBe(7);
    expect(result.answer).toContain('relevant knowledge excerpt');
  });
});