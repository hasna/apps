import { describe, expect, test } from 'bun:test';
import {
  KNOWLEDGE_APP_SLUG,
  KNOWLEDGE_RESOURCE,
  resolveKnowledgeCloudStore,
} from '../src/cloud-store';

const CLEAN_ENV = {} as NodeJS.ProcessEnv;

describe('knowledge cloud-store resolver (postgres client flip)', () => {
  test('resource + slug are the contract-stable values', () => {
    expect(KNOWLEDGE_APP_SLUG).toBe('knowledge');
    expect(KNOWLEDGE_RESOURCE).toBe('notes');
  });

  test('returns null (local) when no env is set', () => {
    expect(resolveKnowledgeCloudStore(CLEAN_ENV)).toBeNull();
  });

  test('returns null (local) when mode=sqlite even with API url+key present', () => {
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'sqlite',
      HASNA_KNOWLEDGE_API_URL: 'https://knowledge.md',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    } as NodeJS.ProcessEnv);
    expect(store).toBeNull();
  });

  test('throws (never silent local drift) when postgres is requested but API key is missing', () => {
    expect(() =>
      resolveKnowledgeCloudStore({
        HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
        HASNA_KNOWLEDGE_API_URL: 'https://knowledge.md',
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  test('resolves an http store pointed at the configured URL when postgres + url + key', () => {
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
      HASNA_KNOWLEDGE_API_URL: 'https://knowledge.md',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    } as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(store!.baseUrl).toBe('https://knowledge.md/v1');
  });

  test('stays local when ONLY API url+key are set — presence is not a selection', () => {
    // INVERTED, deliberately. This case used to route to cloud so that a fleet
    // flip writing only the two pointer vars would take effect. That made the
    // backend a function of ambient environment: those two variables exported in
    // a login shell are inherited by every pane from the tmux server, so a test
    // run believing it was isolated wrote to the live store, and it surfaced as
    // 99 unrelated test failures rather than as "you are pointed at production".
    //
    // The flip must now write an explicit mode as well. That is a coordination
    // cost paid once, against a class of silent production writes.
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_API_URL: 'https://knowledge.md',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    } as NodeJS.ProcessEnv);
    expect(store).toBeNull();
  });

  test('the same pointers WITH an explicit postgres backend do route to the API', () => {
    // The other half of the inverted case above: nothing about reaching the
    // cloud got harder, it just has to be asked for.
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
      HASNA_KNOWLEDGE_API_URL: 'https://knowledge.md',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    } as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(store!.baseUrl).toBe('https://knowledge.md/v1');
  });

  test('stays local when only the API url is set (key missing -> not both)', () => {
    expect(
      resolveKnowledgeCloudStore({
        HASNA_KNOWLEDGE_API_URL: 'https://knowledge.md',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  test('stays local when only the API key is set (url missing -> not both)', () => {
    expect(
      resolveKnowledgeCloudStore({
        HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  test('derives the base URL from the @hasna/contracts fleet domain when no API URL is set', () => {
    // NOTE: this default is NOT sourced from this package's DEFAULT_KNOWLEDGE_API_URL.
    // It comes from the @hasna/contracts dependency and now requires an explicit
    // fleet domain instead of silently assuming Hasna's SaaS hostname.
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
      HASNA_FLEET_API_DOMAIN: 'example.test',
    } as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(store!.baseUrl).toBe('https://knowledge.example.test/v1');
  });

  test('list sends exactly one bounded producer request with repeated tags and uses producer total', async () => {
    const requests: URL[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(request) {
        requests.push(new URL(request.url));
        return Response.json({ items: [], total: 7 });
      },
    });
    try {
      const store = resolveKnowledgeCloudStore({
        NODE_ENV: 'test',
        HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
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
      expect(requests[0]!.searchParams.getAll('tags')).toEqual(['red', 'blue,green']);
      expect(requests[0]!.searchParams.get('archive')).toBe('all');
      expect(requests[0]!.searchParams.get('sort')).toBe('title');
      expect(requests[0]!.searchParams.get('direction')).toBe('desc');
      expect(requests[0]!.searchParams.get('limit')).toBe('2');
      expect(requests[0]!.searchParams.get('offset')).toBe('4');
    } finally {
      server.stop(true);
    }
  });

  test('ranked search sends one producer request and requires rank plus total evidence', async () => {
    const requests: URL[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(request) {
        requests.push(new URL(request.url));
        return Response.json({ items: [], total: 0 });
      },
    });
    try {
      const store = resolveKnowledgeCloudStore({
        NODE_ENV: 'test',
        HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
        HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
      } as NodeJS.ProcessEnv)!;
      expect(await store.search({
        query: 'alpha OR beta',
        archive: 'active',
        limit: 3,
        offset: 6,
      })).toEqual({ items: [], total: 0 });
      expect(requests).toHaveLength(1);
      expect(requests[0]!.pathname).toBe('/v1/notes/search');
      expect(requests[0]!.searchParams.get('q')).toBe('alpha OR beta');
      expect(requests[0]!.searchParams.get('limit')).toBe('3');
      expect(requests[0]!.searchParams.get('offset')).toBe('6');
    } finally {
      server.stop(true);
    }
  });
});
