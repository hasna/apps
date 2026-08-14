import { describe, it, expect, mock } from 'bun:test';
import { TykClient, DEFAULT_BASE_URL } from './client';
import { Tyk } from './index';
import { TykApiError } from '../types';

function restoreFetch(original: typeof globalThis.fetch) {
  globalThis.fetch = original;
}

describe('TykClient', () => {
  it('should require an API key', () => {
    expect(() => new TykClient({ apiKey: '' })).toThrow('API key is required');
  });

  it('should use default base URL', () => {
    const client = new TykClient({ apiKey: 'test-key' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  it('should allow base URL override', () => {
    const client = new TykClient({
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

    const client = new TykClient({ apiKey: 'my-api-key' });
    await client.get('/apis');

    expect(capturedHeaders.Authorization).toBe('Bearer my-api-key');
    restoreFetch(originalFetch);
  });

  it('should request GET /apis on default base URL', async () => {
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

    const client = new TykClient({ apiKey: 'key' });
    await client.get('/apis');

    expect(capturedUrl).toBe(`${DEFAULT_BASE_URL}/apis`);
    restoreFetch(originalFetch);
  });

  it('should encode api ID in path', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: unknown) => {
      capturedUrl = String(url);
      return Promise.resolve(
        new Response(JSON.stringify({ api_id: 'a/b' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const api = new Tyk({ apiKey: 'key' });
    await api.getApi('a/b');

    expect(capturedUrl).toBe(`${DEFAULT_BASE_URL}/apis/a%2Fb`);
    restoreFetch(originalFetch);
  });

  it('should throw TykApiError on non-ok response', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      )
    ) as any;

    const client = new TykClient({ apiKey: 'bad-key' });

    try {
      await client.get('/apis');
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TykApiError);
      expect((err as TykApiError).statusCode).toBe(401);
      expect((err as TykApiError).message).toContain('Unauthorized');
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

    const api = new Tyk({ apiKey: 'key' });
    await api.search({ query: 'gateway' });

    expect(capturedUrl).toBe(`${DEFAULT_BASE_URL}/search`);
    expect(capturedMethod).toBe('POST');
    expect(JSON.parse(capturedBody)).toEqual({ query: 'gateway' });

    restoreFetch(originalFetch);
  });
});

describe('Tyk', () => {
  it('should expose underlying client', () => {
    const api = new Tyk({ apiKey: 'key' });
    expect(api.getClient()).toBeInstanceOf(TykClient);
  });
});
