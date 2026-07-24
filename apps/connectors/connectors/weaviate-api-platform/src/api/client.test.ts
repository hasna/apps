import { afterEach, describe, expect, test } from 'bun:test';
import { Connector, DEFAULT_BASE_URL } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
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

describe('WeaviateApiPlatform client', () => {
  test('uses bearer auth and default base URL for listItems', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'test-api-key' });
    await client.listItems();
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/items`);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization || recorded[0].headers.Authorization).toBe('Bearer test-api-key');
  });

  test('encodes item IDs in getItem path', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'test-api-key' });
    await client.getItem('item/with/slash');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/items/${encodeURIComponent('item/with/slash')}`);
  });

  test('posts search body to /search', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'test-api-key' });
    await client.search({ query: 'hello', limit: 5 });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/search`);
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toBe(JSON.stringify({ query: 'hello', limit: 5 }));
  });

  test('respects custom base URL from config', async () => {
    const recorded = installFetch();
    const client = new Connector({
      apiKey: 'test-api-key',
      baseUrl: 'https://custom.example.com/v1/',
    });
    await client.listEvents();
    expect(recorded[0].url).toBe('https://custom.example.com/v1/events');
  });

  test('requires API key', () => {
    expect(() => new Connector({})).toThrow('API key is required');
  });
});
