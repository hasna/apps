import { describe, test, expect, mock, afterEach } from 'bun:test';
import { WindmillApiPlatformClient, DEFAULT_BASE_URL } from './client';
import { WindmillApiPlatform } from './index';

const originalFetch = globalThis.fetch;

describe('WindmillApiPlatformClient', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('requires apiKey', () => {
    expect(() => new WindmillApiPlatformClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('uses default base URL', () => {
    const client = new WindmillApiPlatformClient({ apiKey: 'test-key' });
    expect(client.buildUrl('/items')).toBe(`${DEFAULT_BASE_URL}/items`);
  });

  test('supports custom base URL', () => {
    const client = new WindmillApiPlatformClient({
      apiKey: 'test-key',
      baseUrl: 'https://custom.example.com/v2/',
    });
    expect(client.buildUrl('/items')).toBe('https://custom.example.com/v2/items');
  });

  test('getApiKeyPreview masks key', () => {
    const client = new WindmillApiPlatformClient({ apiKey: 'windmill-api-platform-key' });
    expect(client.getApiKeyPreview()).toBe('windmi...-key');
  });

  test('listItems sends bearer auth and correct URL', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        init,
      });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;

    const client = new WindmillApiPlatformClient({ apiKey: 'windmill-api-platform-key' });
    await client.listItems();

    expect(captured[0]?.url).toBe('https://api.windmillapiplatform.com/v1/items');
    expect(new Headers(captured[0]?.init?.headers).get('Authorization')).toBe('Bearer windmill-api-platform-key');
  });

  test('getItem encodes item ID in URL', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        init,
      });
      return Response.json({ id: 'item-1' });
    }) as unknown as typeof fetch;

    const client = new WindmillApiPlatformClient({ apiKey: 'windmill-api-platform-key' });
    await client.getItem('item-1');

    expect(captured[0]?.url).toBe('https://api.windmillapiplatform.com/v1/items/item-1');
    expect(new Headers(captured[0]?.init?.headers).get('Authorization')).toBe('Bearer windmill-api-platform-key');
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

    const client = new WindmillApiPlatformClient({ apiKey: 'windmill-api-platform-key' });
    await client.search({ query: 'test' });

    expect(captured[0]?.url).toBe('https://api.windmillapiplatform.com/v1/search');
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

    const client = new WindmillApiPlatformClient({ apiKey: 'windmill-api-platform-key' });
    await client.rawRequest({ method: 'PATCH', path: '/items/custom', body: { status: 'active' } });

    expect(captured[0]?.url).toBe('https://api.windmillapiplatform.com/v1/items/custom');
    expect(captured[0]?.init?.method).toBe('PATCH');
  });
});

describe('WindmillApiPlatform', () => {
  test('fromEnv requires WINDMILL_API_PLATFORM_API_KEY', () => {
    const previous = process.env.WINDMILL_API_PLATFORM_API_KEY;
    delete process.env.WINDMILL_API_PLATFORM_API_KEY;
    expect(() => WindmillApiPlatform.fromEnv()).toThrow('WINDMILL_API_PLATFORM_API_KEY');
    if (previous !== undefined) process.env.WINDMILL_API_PLATFORM_API_KEY = previous;
  });
});
