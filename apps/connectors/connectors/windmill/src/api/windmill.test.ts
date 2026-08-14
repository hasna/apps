import { describe, test, expect, mock, afterEach } from 'bun:test';
import { WindmillClient, DEFAULT_BASE_URL } from './client';
import { Windmill } from './index';

const originalFetch = globalThis.fetch;

describe('WindmillClient', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('requires apiKey', () => {
    expect(() => new WindmillClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('uses default base URL', () => {
    const client = new WindmillClient({ apiKey: 'test-key' });
    expect(client.buildUrl('/scripts')).toBe(`${DEFAULT_BASE_URL}/scripts`);
  });

  test('supports custom base URL', () => {
    const client = new WindmillClient({
      apiKey: 'test-key',
      baseUrl: 'https://app.windmill.dev/api/w/demo/',
    });
    expect(client.buildUrl('/scripts')).toBe('https://app.windmill.dev/api/w/demo/scripts');
  });

  test('getApiKeyPreview masks key', () => {
    const client = new WindmillClient({ apiKey: 'windmill-test-key' });
    expect(client.getApiKeyPreview()).toBe('windmi...-key');
  });

  test('listScripts sends bearer auth and correct URL', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        init,
      });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;

    const client = new WindmillClient({ apiKey: 'windmill-test-key' });
    await client.listScripts();

    expect(captured[0]?.url).toBe('https://api.windmill.dev/v1/scripts');
    expect(new Headers(captured[0]?.init?.headers).get('Authorization')).toBe('Bearer windmill-test-key');
  });

  test('getScript encodes script ID in URL', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        init,
      });
      return Response.json({ path: 'f/scripts/hello' });
    }) as unknown as typeof fetch;

    const client = new WindmillClient({ apiKey: 'windmill-test-key' });
    await client.getScript('f/scripts/hello');

    expect(captured[0]?.url).toBe('https://api.windmill.dev/v1/scripts/f%2Fscripts%2Fhello');
    expect(new Headers(captured[0]?.init?.headers).get('Authorization')).toBe('Bearer windmill-test-key');
  });

  test('search posts JSON body to /search', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        init,
      });
      return Response.json({ results: [] });
    }) as unknown as typeof fetch;

    const client = new WindmillClient({ apiKey: 'windmill-test-key' });
    await client.search({ query: 'test' });

    expect(captured[0]?.url).toBe('https://api.windmill.dev/v1/search');
    expect(captured[0]?.init?.method).toBe('POST');
    expect(captured[0]?.init?.body).toBe(JSON.stringify({ query: 'test' }));
  });

  test('rawRequest supports custom method and path', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        init,
      });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;

    const client = new WindmillClient({ apiKey: 'windmill-test-key' });
    await client.rawRequest({ method: 'PATCH', path: '/scripts/custom', body: { summary: 'updated' } });

    expect(captured[0]?.url).toBe('https://api.windmill.dev/v1/scripts/custom');
    expect(captured[0]?.init?.method).toBe('PATCH');
  });
});

describe('Windmill', () => {
  test('fromEnv requires WINDMILL_API_KEY', () => {
    const previous = process.env.WINDMILL_API_KEY;
    delete process.env.WINDMILL_API_KEY;
    expect(() => Windmill.fromEnv()).toThrow('WINDMILL_API_KEY');
    if (previous !== undefined) process.env.WINDMILL_API_KEY = previous;
  });
});
