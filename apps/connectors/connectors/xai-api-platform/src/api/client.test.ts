import { afterEach, describe, expect, test } from 'bun:test';
import { XaiApiPlatform } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
}

function installFetch(): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = new Headers(init?.headers);
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ ok: true });
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('XaiApiPlatformClient', () => {
  const apiKey = 'xai-api-platform-key';
  const client = new XaiApiPlatform({ apiKey });

  test('listItems uses bearer auth and /items endpoint', async () => {
    const recorded = installFetch();
    await client.listItems();
    expect(recorded[0].url).toBe('https://api.xaiapiplatform.com/v1/items');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.get('Authorization')).toBe(`Bearer ${apiKey}`);
  });

  test('getItem URL-encodes path segments', async () => {
    const recorded = installFetch();
    await client.getItem('item-1');
    expect(recorded[0].url).toBe('https://api.xaiapiplatform.com/v1/items/item-1');
    expect(recorded[0].headers.get('Authorization')).toBe(`Bearer ${apiKey}`);
  });

  test('createItem posts JSON body to /items', async () => {
    const recorded = installFetch();
    await client.createItem({ name: 'test' });
    expect(recorded[0].url).toBe('https://api.xaiapiplatform.com/v1/items');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toBe(JSON.stringify({ name: 'test' }));
  });

  test('listEvents hits /events', async () => {
    const recorded = installFetch();
    await client.listEvents({ limit: 10 });
    expect(recorded[0].url).toBe('https://api.xaiapiplatform.com/v1/events?limit=10');
  });

  test('search posts to /search', async () => {
    const recorded = installFetch();
    await client.search({ q: 'hello' });
    expect(recorded[0].url).toBe('https://api.xaiapiplatform.com/v1/search');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toBe(JSON.stringify({ q: 'hello' }));
  });

  test('rawRequest supports custom path and method', async () => {
    const recorded = installFetch();
    await client.rawRequest('/custom', { method: 'POST', body: { a: 1 } });
    expect(recorded[0].url).toBe('https://api.xaiapiplatform.com/v1/custom');
    expect(recorded[0].method).toBe('POST');
  });

  test('requires API key', () => {
    expect(() => new XaiApiPlatform({ apiKey: '' })).toThrow('API key is required');
  });
});
