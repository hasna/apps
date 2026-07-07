import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { YouSearchClient } from './client';
import { SearchApi } from './search';

describe('YouSearchClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(JSON.stringify({ results: { web: [], news: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('GET /v1/search builds URL and X-API-Key header per platform contract', async () => {
    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ results: { web: [], news: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new YouSearchClient({ apiKey: 'test-api-key-12345' });
    const search = new SearchApi(client);

    await search.search({ query: 'alumia', count: 5 });

    expect(capturedUrl).toBe('https://api.you.com/v1/search?query=alumia&count=5');

    const headers = capturedHeaders as Record<string, string>;
    expect(headers['X-API-Key']).toBe('test-api-key-12345');
    expect(headers['Accept']).toBe('application/json');
  });

  test('buildUrl respects custom baseUrl', () => {
    const client = new YouSearchClient({
      apiKey: 'key',
      baseUrl: 'https://custom.example.com',
    });

    expect(client.buildUrl('/v1/search', { query: 'test' }))
      .toBe('https://custom.example.com/v1/search?query=test');
  });
});
