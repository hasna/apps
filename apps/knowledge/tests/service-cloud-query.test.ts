import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
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

  test('hosted and local context packs enforce the same token and UTF-8 byte ceilings', async () => {
    const maxTokens = 800;
    const maxBytes = 3_200;
    const hosted = await serviceFor('hosted-pack-budget').contextPack({
      query: 'producer doctrine',
      limit: 1,
      maxItems: 1,
      maxTokens,
      maxBytes,
    });
    expectOneProducerRequest('producer doctrine');

    const localHome = mkdtempSync(join(tmpdir(), 'knowledge-local-pack-budget-'));
    const dbPath = join(localHome, 'knowledge.db');
    const sourcePath = join(localHome, 'source.md');
    writeFileSync(sourcePath, producerItem.content);
    const childEnv = { ...process.env, HASNA_KNOWLEDGE_LOCAL: '1' } as Record<string, string>;
    delete childEnv.HASNA_KNOWLEDGE_API_URL;
    delete childEnv.HASNA_KNOWLEDGE_API_KEY;
    delete childEnv.KNOWLEDGE_API_KEY;
    const localScript = `
      import { buildKnowledgeAgentContextPack } from ${JSON.stringify(new URL('../src/context-pack.ts', import.meta.url).href)};
      import { ingestSourceRef } from ${JSON.stringify(new URL('../src/source-ingest.ts', import.meta.url).href)};
      import { defaultKnowledgeConfig, workspaceForHome } from ${JSON.stringify(new URL('../src/workspace.ts', import.meta.url).href)};
      import { resolveSafetyPolicy } from ${JSON.stringify(new URL('../src/safety.ts', import.meta.url).href)};
      const dbPath = ${JSON.stringify(dbPath)};
      const localHome = ${JSON.stringify(localHome)};
      await ingestSourceRef({ dbPath, sourceRef: ${JSON.stringify(`file://${sourcePath}`)}, purpose: 'knowledge_index' });
      const pack = await buildKnowledgeAgentContextPack({
        dbPath,
        safetyPolicy: resolveSafetyPolicy(defaultKnowledgeConfig(), workspaceForHome(localHome)),
        source: 'search',
        query: 'producer doctrine',
        maxItems: 1,
        maxTokens: ${maxTokens},
        maxBytes: ${maxBytes},
      });
      console.log(JSON.stringify(pack));
    `;
    const child = Bun.spawn([process.execPath, '--eval', localScript], {
      env: childEnv,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, localStdout, localStderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode, localStderr).toBe(0);
    const local = JSON.parse(localStdout);

    for (const pack of [hosted, local]) {
      expect(pack.budgets.max_tokens).toBe(maxTokens);
      expect(pack.budgets.max_bytes).toBe(maxBytes);
      expect(pack.budgets.estimated_tokens).toBeLessThanOrEqual(maxTokens);
      expect(pack.budgets.encoded_bytes).toBeLessThanOrEqual(maxBytes);
      expect(pack.budgets.token_budget_exceeded).toBe(false);
      expect(pack.budgets.byte_budget_exceeded).toBe(false);
      expect(Buffer.byteLength(JSON.stringify(pack))).toBeLessThanOrEqual(maxBytes);
    }
  });
});
