import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { TesterArmyClient, encodePathSegment, DEFAULT_BASE_URL } from './client';

describe('encodePathSegment', () => {
  test('encodes special characters in path segments', () => {
    expect(encodePathSegment('a/b')).toBe('a%2Fb');
    expect(encodePathSegment('id with spaces')).toBe('id%20with%20spaces');
  });
});

describe('TesterArmyClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      return new Response(JSON.stringify({ url, method: init?.method || 'GET', auth: headers?.Authorization }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('uses default base URL and Bearer auth', async () => {
    const client = new TesterArmyClient({ apiKey: 'test-key' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);

    const result = await client.get<{ url: string; auth: string }>('/v1/projects');
    expect(result.url).toBe('https://tester.army/v1/projects');
    expect(result.auth).toBe('Bearer test-key');
  });

  test('respects custom base URL', async () => {
    const client = new TesterArmyClient({ apiKey: 'test-key', baseUrl: 'https://custom.example/' });
    const result = await client.get<{ url: string }>('/v1/tests');
    expect(result.url).toBe('https://custom.example/v1/tests');
  });

  test('omits Bearer auth when auth is false', async () => {
    const client = new TesterArmyClient({ apiKey: 'test-key' });
    const result = await client.request<{ auth?: string }>('/v1/webhook/wh/sec', {
      method: 'POST',
      auth: false,
      body: {},
    });
    expect(result.auth).toBeUndefined();
  });

  test('appends query parameters', async () => {
    const client = new TesterArmyClient({ apiKey: 'test-key' });
    const result = await client.get<{ url: string }>('/v1/runs', { limit: 5, status: 'running' });
    expect(result.url).toBe('https://tester.army/v1/runs?limit=5&status=running');
  });
});
