import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKnowledgeService } from '../src/service';

const producerHit = {
  kind: 'note' as const,
  id: 'k_producer_ranked',
  title: 'Producer-ranked doctrine',
  snippet: 'The producer-ranked result is the only evidence this bounded page should expose.',
  url: null as string | null,
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
      if (url.pathname === '/v1/search') {
        producerRequests.push(url);
        return Response.json({
          results: [producerHit],
          total: 1,
          query: 'producer doctrine',
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
  expect(producerRequests[0]!.pathname).toBe('/v1/search');
  expect(producerRequests[0]!.searchParams.get('q')).toBe(query);
  expect(producerRequests[0]!.searchParams.get('kind')).toBe('note');
  expect(fallbackRequests).toHaveLength(0);
}

describe('KnowledgeService bounded producer query path', () => {
  test('search performs one producer request and adapts the deployed rankless envelope', async () => {
    const service = serviceFor('search');
    const result = await service.search({ query: 'producer doctrine', limit: 1, offset: 2 });

    expectOneProducerRequest('producer doctrine');
    expect(producerRequests[0]!.searchParams.get('limit')).toBe('1');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.id).toBe(producerHit.id);
    expect(result.results[0]!.title).toBe(producerHit.title);
    expect(result.results[0]!.text).toBe(producerHit.snippet);
    // The deployed unified envelope exposes no producer rank; the keyword
    // score degrades to zero rather than fabricating one.
    expect(result.results[0]!.scores.keyword).toBe(0);
    expect(result.counts.keyword_results).toBe(1);
  });

  test('retrieveContext uses the same single producer request without list paging', async () => {
    const service = serviceFor('context');
    const result = await service.retrieveContext({ query: 'producer context', limit: 1 });

    expectOneProducerRequest('producer context');
    expect(result.results[0]!.id).toBe(producerHit.id);
    expect(result.results[0]!.scores.keyword).toBe(0);
    expect(result.search_counts.keyword_results).toBe(1);
    expect(result.citations[0]!.source_uri).toBe(`knowledge://item/${producerHit.id}`);
  });

  test('runPrompt shares the bounded producer result without re-fetching the collection', async () => {
    const service = serviceFor('prompt');
    const result = await service.runPrompt({ prompt: 'producer prompt', limit: 1 });

    expectOneProducerRequest('producer prompt');
    expect(result.generated).toBe(false);
    expect(result.context.results[0]!.id).toBe(producerHit.id);
    expect(result.context.results[0]!.scores.keyword).toBe(0);
    expect(result.context.search_counts.keyword_results).toBe(1);
    expect(result.answer).toContain('relevant knowledge excerpt');
  });
});
