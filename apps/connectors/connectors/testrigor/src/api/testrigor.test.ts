import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TestRigor } from './index';
import { TestRigorClient, DEFAULT_BASE_URL } from './client';

describe('TestRigorClient', () => {
  test('requires api key', () => {
    expect(() => new TestRigorClient({ apiKey: '' })).toThrow('TestRigor API key is required');
  });

  test('uses default base URL', () => {
    const client = new TestRigorClient({ apiKey: 'test-key' });
    expect(client).toBeDefined();
    expect(DEFAULT_BASE_URL).toBe('https://api.testrigor.com/v1');
  });
});

describe('TestRigor API', () => {
  const originalFetch = globalThis.fetch;
  let captured: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    captured = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        init,
      });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('listSuites sends Bearer auth and correct URL', async () => {
    const api = new TestRigor({ apiKey: 'testrigor-key' });
    await api.listSuites();

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe('https://api.testrigor.com/v1/suites');
    expect(new Headers(captured[0].init?.headers).get('Authorization')).toBe('Bearer testrigor-key');
  });

  test('getSuite encodes suite id in URL', async () => {
    const api = new TestRigor({ apiKey: 'testrigor-key' });
    await api.getSuite('item-1');

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe('https://api.testrigor.com/v1/suites/item-1');
    expect(new Headers(captured[0].init?.headers).get('Authorization')).toBe('Bearer testrigor-key');
  });

  test('search posts JSON body', async () => {
    const api = new TestRigor({ apiKey: 'testrigor-key' });
    await api.search({ query: 'login flow' });

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe('https://api.testrigor.com/v1/search');
    expect(captured[0].init?.method).toBe('POST');
    expect(captured[0].init?.body).toBe(JSON.stringify({ query: 'login flow' }));
  });

  test('fromEnv requires TESTRIGOR_API_KEY', () => {
    const original = process.env.TESTRIGOR_API_KEY;
    delete process.env.TESTRIGOR_API_KEY;
    expect(() => TestRigor.fromEnv()).toThrow('TESTRIGOR_API_KEY is required');
    if (original) process.env.TESTRIGOR_API_KEY = original;
  });
});
