import { describe, it, expect, mock } from 'bun:test';
import { TykApiPlatformClient } from './client';
import { TykApiPlatform } from './index';
import { TykApiPlatformApiError } from '../types';

function restoreFetch(original: typeof globalThis.fetch) {
  globalThis.fetch = original;
}

describe('TykApiPlatformClient', () => {
  it('should require an API key', () => {
    expect(() => new TykApiPlatformClient({ apiKey: '', baseUrl: 'https://configured.example.com/v1' })).toThrow('API key is required');
  });

  it('refuses to send without a configured base URL (no default endpoint)', () => {
    expect(() => new TykApiPlatformClient({ apiKey: 'test-key' })).toThrow(/baseUrl/);
  });

  it('should allow base URL override', () => {
    const client = new TykApiPlatformClient({
      apiKey: 'test-key',
      baseUrl: 'https://custom.example.com/v2/',
    });
    expect(client.getBaseUrl()).toBe('https://custom.example.com/v2');
  });

  it('should include Bearer Authorization header', async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock((_url: unknown, options: RequestInit) => {
      capturedHeaders = options.headers as Record<string, string>;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new TykApiPlatformClient({ apiKey: 'my-api-key', baseUrl: 'https://configured.example.com/v1' });
    await client.get('/items');

    expect(capturedHeaders.Authorization).toBe('Bearer my-api-key');
    restoreFetch(originalFetch);
  });

  it('should request GET /items on the configured base URL', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: unknown) => {
      capturedUrl = String(url);
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new TykApiPlatformClient({ apiKey: 'key', baseUrl: 'https://configured.example.com/v1' });
    await client.get('/items');

    expect(capturedUrl).toBe(`https://configured.example.com/v1/items`);
    restoreFetch(originalFetch);
  });

  it('should encode item ID in path', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: unknown) => {
      capturedUrl = String(url);
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'a/b' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const api = new TykApiPlatform({ apiKey: 'key', baseUrl: 'https://configured.example.com/v1' });
    await api.getItem('a/b');

    expect(capturedUrl).toBe(`https://configured.example.com/v1/items/a%2Fb`);
    restoreFetch(originalFetch);
  });

  it('should throw TykApiPlatformApiError on non-ok response', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      )
    ) as any;

    const client = new TykApiPlatformClient({ apiKey: 'bad-key', baseUrl: 'https://configured.example.com/v1' });

    try {
      await client.get('/items');
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TykApiPlatformApiError);
      expect((err as TykApiPlatformApiError).statusCode).toBe(401);
      expect((err as TykApiPlatformApiError).message).toContain('Unauthorized');
    }

    restoreFetch(originalFetch);
  });

  it('should POST search payload to /search', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody = '';

    globalThis.fetch = mock((url: unknown, options: RequestInit) => {
      capturedUrl = String(url);
      capturedMethod = options.method || 'GET';
      capturedBody = options.body as string;
      return Promise.resolve(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const api = new TykApiPlatform({ apiKey: 'key', baseUrl: 'https://configured.example.com/v1' });
    await api.search({ query: 'gateway' });

    expect(capturedUrl).toBe(`https://configured.example.com/v1/search`);
    expect(capturedMethod).toBe('POST');
    expect(JSON.parse(capturedBody)).toEqual({ query: 'gateway' });

    restoreFetch(originalFetch);
  });
});

describe('TykApiPlatform', () => {
  it('should expose underlying client', () => {
    const api = new TykApiPlatform({ apiKey: 'key', baseUrl: 'https://configured.example.com/v1' });
    expect(api.getClient()).toBeInstanceOf(TykApiPlatformClient);
  });
});
