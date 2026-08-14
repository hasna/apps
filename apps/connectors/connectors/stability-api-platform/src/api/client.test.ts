import { afterEach, describe, expect, test } from 'bun:test';
import { StabilityApiPlatform, DEFAULT_BASE_URL } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
}

function installFetch(handler?: (recorded: RecordedRequest) => unknown) {
  const recorded: RecordedRequest[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? init.body : undefined;
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body,
    });

    const payload = handler ? handler(recorded[recorded.length - 1]) : { ok: true };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(payload ?? {});
      },
    } as Response;
  }) as typeof fetch;

  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('StabilityApiPlatform client', () => {
  test('requires api key', () => {
    expect(() => new StabilityApiPlatform({ apiKey: '' })).toThrow('API key is required');
  });

  test('listItems sends bearer auth to /v1/items', async () => {
    const recorded = installFetch();
    const client = new StabilityApiPlatform({ apiKey: 'stability-api-platform-key' });

    await client.listItems();

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/items`);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer stability-api-platform-key');
  });

  test('getItem encodes item id in URL path', async () => {
    const recorded = installFetch();
    const client = new StabilityApiPlatform({ apiKey: 'stability-api-platform-key' });

    await client.getItem('item-1');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/items/item-1`);
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer stability-api-platform-key');
  });

  test('createItem POSTs JSON body to /items', async () => {
    const recorded = installFetch();
    const client = new StabilityApiPlatform({ apiKey: 'test-key' });

    await client.createItem({ name: 'widget' });

    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/items`);
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({ name: 'widget' });
  });

  test('listEvents GETs /events', async () => {
    const recorded = installFetch();
    const client = new StabilityApiPlatform({ apiKey: 'test-key' });

    await client.listEvents({ limit: 5 });

    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/events?limit=5`);
    expect(recorded[0].method).toBe('GET');
  });

  test('search POSTs to /search', async () => {
    const recorded = installFetch();
    const client = new StabilityApiPlatform({ apiKey: 'test-key' });

    await client.search({ q: 'hello' });

    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/search`);
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({ q: 'hello' });
  });

  test('rawRequest honors custom method and path', async () => {
    const recorded = installFetch();
    const client = new StabilityApiPlatform({ apiKey: 'test-key', baseUrl: 'https://custom.example/v1' });

    await client.rawRequest({ method: 'DELETE', path: '/items/x', query: { force: true } });

    expect(recorded[0].url).toBe('https://custom.example/v1/items/x?force=true');
    expect(recorded[0].method).toBe('DELETE');
  });

  test('fromEnv requires STABILITY_API_PLATFORM_API_KEY', () => {
    const original = process.env.STABILITY_API_PLATFORM_API_KEY;
    delete process.env.STABILITY_API_PLATFORM_API_KEY;

    expect(() => StabilityApiPlatform.fromEnv()).toThrow('STABILITY_API_PLATFORM_API_KEY');

    if (original) process.env.STABILITY_API_PLATFORM_API_KEY = original;
  });
});
