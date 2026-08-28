import { describe, expect, test } from 'bun:test';
import {
  KNOWLEDGE_APP_SLUG,
  KNOWLEDGE_BOUNDED_QUERY_CAPABILITY,
  KNOWLEDGE_RESOURCE,
  KnowledgeBoundedQueryCapabilityError,
  resolveKnowledgeHttpStore,
} from '../src/http-store';
import type { KnowledgeItem } from '../src/store';

const CLEAN_ENV = {} as NodeJS.ProcessEnv;
const NOW = '2026-08-10T00:00:00.000Z';
const OLD_SERVER_ITEM: KnowledgeItem = {
  id: 'k_old_server',
  short_id: 'old',
  title: 'Plausible old-server result',
  content: 'This row is deliberately plausible even when the old server ignored a query field.',
  url: null,
  tags: ['other'],
  metadata: {},
  archived: false,
  created_at: NOW,
  updated_at: NOW,
};

describe('knowledge HTTP store resolver', () => {
  test('resource + slug are the contract-stable values', () => {
    expect(KNOWLEDGE_APP_SLUG).toBe('knowledge');
    expect(KNOWLEDGE_RESOURCE).toBe('notes');
  });

  test('returns null for the on-box transport when the canonical API URL is absent', () => {
    expect(resolveKnowledgeHttpStore(CLEAN_ENV)).toBeNull();
  });

  test('fails closed when the canonical API URL is present without its key', () => {
    expect(() =>
      resolveKnowledgeHttpStore({
        HASNA_KNOWLEDGE_API_URL: 'https://knowledge.md',
      } as NodeJS.ProcessEnv),
    ).toThrow(/HASNA_KNOWLEDGE_API_KEY/);
  });

  test('canonical API URL plus key selects the HTTP store', () => {
    const store = resolveKnowledgeHttpStore({
      HASNA_KNOWLEDGE_API_URL: 'https://knowledge.md',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    } as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(store!.baseUrl).toBe('https://knowledge.md/v1');
  });

  test('the unprefixed API URL alias is ignored', () => {
    const store = resolveKnowledgeHttpStore({
      KNOWLEDGE_API_URL: 'https://knowledge.md',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    } as NodeJS.ProcessEnv);
    expect(store).toBeNull();
  });

  test('retired selector variables fail loudly and name both replacements', () => {
    expect(() => resolveKnowledgeHttpStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
    } as NodeJS.ProcessEnv)).toThrow(/HASNA_KNOWLEDGE_STORAGE_MODE.*HASNA_KNOWLEDGE_API_URL.*HASNA_KNOWLEDGE_DATABASE_URL/s);
  });

  test('an API key without the canonical URL stays on-box', () => {
    expect(
      resolveKnowledgeHttpStore({
        HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  test('list sends exactly one bounded producer request with repeated tags and uses producer total', async () => {
    const requests: URL[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(request) {
        requests.push(new URL(request.url));
        return Response.json({
          items: [],
          total: 7,
          query_capability: KNOWLEDGE_BOUNDED_QUERY_CAPABILITY,
        });
      },
    });
    try {
      const store = resolveKnowledgeHttpStore({
        NODE_ENV: 'test',
        HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
      } as NodeJS.ProcessEnv)!;
      const result = await store.list({
        search: 'literal % query',
        tags: ['red', 'blue,green'],
        archive: 'all',
        sort: 'title',
        direction: 'desc',
        limit: 2,
        offset: 4,
      });
      expect(result).toEqual({ items: [], total: 7 });
      expect(requests).toHaveLength(1);
      expect(requests[0]!.pathname).toBe('/v1/notes');
      expect(requests[0]!.searchParams.get('filter')).toBe('literal % query');
      expect(requests[0]!.searchParams.get('search')).toBe('literal % query');
      expect(requests[0]!.searchParams.getAll('tags')).toEqual(['red', 'blue,green']);
      expect(requests[0]!.searchParams.get('archive')).toBe('all');
      expect(requests[0]!.searchParams.get('includeArchived')).toBe('true');
      expect(requests[0]!.searchParams.get('sort')).toBe('title');
      expect(requests[0]!.searchParams.get('direction')).toBe('desc');
      expect(requests[0]!.searchParams.get('limit')).toBe('2');
      expect(requests[0]!.searchParams.get('offset')).toBe('4');
    } finally {
      server.stop(true);
    }
  });

  test('ranked search sends one producer request and preserves rank plus total', async () => {
    const requests: URL[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(request) {
        requests.push(new URL(request.url));
        // The deployed knowledge server (0.2.114) serves search at
        // /v1/notes/search: { items: [{ item, rank }], total,
        // query_capability } — the pre-unified contract measured live on
        // 2026-08-26.
        return Response.json({
          items: [{ item: OLD_SERVER_ITEM, rank: 0.875 }],
          total: 7,
          query_capability: KNOWLEDGE_BOUNDED_QUERY_CAPABILITY,
        });
      },
    });
    try {
      const store = resolveKnowledgeHttpStore({
        NODE_ENV: 'test',
        HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
      } as NodeJS.ProcessEnv)!;
      const result = await store.search({
        query: 'alpha OR beta',
        archive: 'active',
        limit: 3,
        offset: 6,
      });
      expect(result.total).toBe(7);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.rank).toBe(0.875);
      expect(result.items[0]!.item).toEqual(OLD_SERVER_ITEM);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.pathname).toBe('/v1/notes/search');
      expect(requests[0]!.searchParams.get('q')).toBe('alpha OR beta');
      expect(requests[0]!.searchParams.get('archive')).toBe('active');
      expect(requests[0]!.searchParams.get('limit')).toBe('3');
      expect(requests[0]!.searchParams.get('offset')).toBe('6');
    } finally {
      server.stop(true);
    }
  });

  test('search refuses malformed rank evidence instead of returning a plausible empty page', async () => {
    const requests: URL[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(request) {
        requests.push(new URL(request.url));
        return Response.json({
          items: [{ item: null, rank: 0.5 }],
          total: 1,
          query_capability: KNOWLEDGE_BOUNDED_QUERY_CAPABILITY,
        });
      },
    });
    try {
      const store = resolveKnowledgeHttpStore({
        NODE_ENV: 'test',
        HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
      } as NodeJS.ProcessEnv)!;
      await expect(store.search({ query: 'alpha OR beta' })).rejects.toThrow(
        /knowledge HTTP search response is missing producer rank or total evidence/,
      );
      expect(requests).toHaveLength(1);
    } finally {
      server.stop(true);
    }
  });

  test('search fails closed when the producer omits the bounded-query capability', async () => {
    const requests: URL[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(request) {
        requests.push(new URL(request.url));
        // Plausible ranked page, but no bounded-query marker: an unbounded
        // page must never be consumed as if the server applied the query.
        return Response.json({
          items: [{ item: OLD_SERVER_ITEM, rank: 0.5 }],
          total: 1,
        });
      },
    });
    try {
      const store = resolveKnowledgeHttpStore({
        NODE_ENV: 'test',
        HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
      } as NodeJS.ProcessEnv)!;
      await expect(store.search({ query: 'alpha OR beta' })).rejects.toThrow(
        KnowledgeBoundedQueryCapabilityError,
      );
      expect(requests).toHaveLength(1);
    } finally {
      server.stop(true);
    }
  });

  test('new client dual-sends safe aliases and accepts a plausible old-server list response', async () => {
    const requests: URL[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(request) {
        requests.push(new URL(request.url));
        // Deliberately no query_capability: this simulates the prior server.
        return Response.json({ items: [OLD_SERVER_ITEM], total: 1 });
      },
    });
    try {
      const store = resolveKnowledgeHttpStore({
        NODE_ENV: 'test',
        HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
      } as NodeJS.ProcessEnv)!;
      const result = await store.list({
        search: 'plausible',
        archive: 'all',
        limit: 1,
        offset: 0,
      });
      expect(result).toEqual({ items: [OLD_SERVER_ITEM], total: 1 });
      expect(requests).toHaveLength(1);
      expect(requests[0]!.searchParams.get('filter')).toBe('plausible');
      expect(requests[0]!.searchParams.get('search')).toBe('plausible');
      expect(requests[0]!.searchParams.get('archive')).toBe('all');
      expect(requests[0]!.searchParams.get('includeArchived')).toBe('true');
    } finally {
      server.stop(true);
    }
  });

  const unsupportedOldServerCases: Array<{
    name: string;
    options: Parameters<NonNullable<ReturnType<typeof resolveKnowledgeHttpStore>>['list']>[0];
    field: string;
  }> = [
    { name: 'tags', options: { tags: ['required'] }, field: 'tags' },
    { name: 'sort', options: { sort: 'title' }, field: 'sort' },
    { name: 'direction', options: { direction: 'desc' }, field: 'direction' },
    { name: 'archived-only', options: { archive: 'archived' }, field: 'archive=archived' },
  ];

  for (const scenario of unsupportedOldServerCases) {
    test(`new client fails loudly when an old server ignores ${scenario.name}`, async () => {
      const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch() {
          // Plausible success envelope, but no marker proving the field was applied.
          return Response.json({ items: [OLD_SERVER_ITEM], total: 1 });
        },
      });
      try {
        const store = resolveKnowledgeHttpStore({
          NODE_ENV: 'test',
          HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${server.port}`,
          HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
        } as NodeJS.ProcessEnv)!;
        const request = store.list(scenario.options);
        await expect(request).rejects.toBeInstanceOf(KnowledgeBoundedQueryCapabilityError);
        await expect(request).rejects.toThrow(scenario.field);
      } finally {
        server.stop(true);
      }
    });
  }

  test('search refuses a non-numeric rank in an otherwise plausible ranked page', async () => {
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch() {
        // A ranked page whose rank is not a finite number is malformed
        // producer evidence — refuse it rather than consuming the hit.
        return Response.json({
          items: [{ item: OLD_SERVER_ITEM, rank: 'high' }],
          total: 5,
          query_capability: KNOWLEDGE_BOUNDED_QUERY_CAPABILITY,
        });
      },
    });
    try {
      const store = resolveKnowledgeHttpStore({
        NODE_ENV: 'test',
        HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
      } as NodeJS.ProcessEnv)!;
      await expect(store.search({ query: 'old response' })).rejects.toThrow(
        /knowledge HTTP search response is missing producer rank or total evidence/,
      );
    } finally {
      server.stop(true);
    }
  });
});
