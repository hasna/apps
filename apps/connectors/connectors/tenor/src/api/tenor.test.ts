import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Connector } from './index';
import { ConnectorClient } from './client';
import { TenorApi } from './tenor';

// ============================================
// Test helpers
// ============================================

const originalFetch = globalThis.fetch;

/** Capture the URLs requested and return a canned JSON body. */
function mockFetch(body: unknown) {
  const calls: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return calls;
}

function lastUrl(calls: string[]): URL {
  return new URL(calls[calls.length - 1]!);
}

beforeEach(() => {
  delete process.env.TENOR_API_KEY;
  delete process.env.TENOR_CLIENT_KEY;
  delete process.env.TENOR_BASE_URL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ============================================
// Authentication / URL construction
// ============================================

describe('ConnectorClient auth', () => {
  test('injects the api key as the `key` query parameter', async () => {
    const calls = mockFetch({ results: [], next: '' });
    const api = new TenorApi(new ConnectorClient({ apiKey: 'test-key-123' }));

    await api.search('cats');

    const url = lastUrl(calls);
    expect(url.origin + url.pathname).toBe('https://tenor.googleapis.com/v2/search');
    expect(url.searchParams.get('key')).toBe('test-key-123');
    // Tenor must NOT use an Authorization header
    expect(url.searchParams.get('q')).toBe('cats');
  });

  test('includes client_key only when provided', async () => {
    const calls = mockFetch({ results: [], next: '' });

    const withoutClient = new TenorApi(new ConnectorClient({ apiKey: 'k' }));
    await withoutClient.featured();
    expect(lastUrl(calls).searchParams.get('client_key')).toBeNull();

    const withClient = new TenorApi(new ConnectorClient({ apiKey: 'k', clientKey: 'my-app' }));
    await withClient.featured();
    expect(lastUrl(calls).searchParams.get('client_key')).toBe('my-app');
  });

  test('honors a custom base URL', async () => {
    const calls = mockFetch({ results: [], next: '' });
    const api = new TenorApi(new ConnectorClient({ apiKey: 'k', baseUrl: 'https://proxy.example.com/tenor' }));

    await api.trendingTerms();

    const url = lastUrl(calls);
    expect(url.origin + url.pathname).toBe('https://proxy.example.com/tenor/trending_terms');
  });

  test('throws when no key is supplied', () => {
    expect(() => new ConnectorClient({})).toThrow('Tenor API key is required');
  });
});

// ============================================
// Endpoint / parameter mapping
// ============================================

describe('TenorApi endpoints', () => {
  let api: TenorApi;

  beforeEach(() => {
    api = new TenorApi(new ConnectorClient({ apiKey: 'k' }));
  });

  test('search maps params to Tenor query names', async () => {
    const calls = mockFetch({ results: [], next: '' });

    await api.search('dogs', {
      limit: 5,
      pos: 'abc',
      locale: 'en_US',
      country: 'US',
      contentFilter: 'high',
      mediaFilter: 'gif,tinygif',
      random: true,
    });

    const p = lastUrl(calls).searchParams;
    expect(p.get('q')).toBe('dogs');
    expect(p.get('limit')).toBe('5');
    expect(p.get('pos')).toBe('abc');
    expect(p.get('locale')).toBe('en_US');
    expect(p.get('country')).toBe('US');
    expect(p.get('contentfilter')).toBe('high');
    expect(p.get('media_filter')).toBe('gif,tinygif');
    expect(p.get('random')).toBe('true');
  });

  test('omits undefined params', async () => {
    const calls = mockFetch({ results: [], next: '' });

    await api.search('dogs');

    const p = lastUrl(calls).searchParams;
    expect(p.has('limit')).toBe(false);
    expect(p.has('media_filter')).toBe(false);
  });

  test('categories hits /categories with type', async () => {
    const calls = mockFetch({ tags: [] });

    await api.categories({ type: 'trending', locale: 'en_US' });

    const url = lastUrl(calls);
    expect(url.pathname).toBe('/v2/categories');
    expect(url.searchParams.get('type')).toBe('trending');
    expect(url.searchParams.get('locale')).toBe('en_US');
  });

  test('autocomplete hits /autocomplete with q', async () => {
    const calls = mockFetch({ results: [] });

    await api.autocomplete('exc', { limit: 3 });

    const url = lastUrl(calls);
    expect(url.pathname).toBe('/v2/autocomplete');
    expect(url.searchParams.get('q')).toBe('exc');
    expect(url.searchParams.get('limit')).toBe('3');
  });

  test('trendingTerms hits /trending_terms', async () => {
    const calls = mockFetch({ results: [] });

    await api.trendingTerms({ limit: 7 });

    const url = lastUrl(calls);
    expect(url.pathname).toBe('/v2/trending_terms');
    expect(url.searchParams.get('limit')).toBe('7');
  });

  test('returns the parsed JSON body', async () => {
    mockFetch({ results: [{ id: '1', title: 'hi' }], next: 'next-token' });

    const res = await api.search('hi');
    expect(res.next).toBe('next-token');
    expect(res.results[0]!.id).toBe('1');
  });
});

// ============================================
// fromEnv
// ============================================

describe('Connector.fromEnv', () => {
  test('reads TENOR_API_KEY and TENOR_CLIENT_KEY', async () => {
    process.env.TENOR_API_KEY = 'env-key';
    process.env.TENOR_CLIENT_KEY = 'env-client';
    const calls = mockFetch({ results: [], next: '' });

    const connector = Connector.fromEnv();
    await connector.tenor.featured();

    const p = lastUrl(calls).searchParams;
    expect(p.get('key')).toBe('env-key');
    expect(p.get('client_key')).toBe('env-client');
  });

  test('throws when TENOR_API_KEY is missing', () => {
    expect(() => Connector.fromEnv()).toThrow('TENOR_API_KEY environment variable is required');
  });
});
