import { afterEach, describe, expect, test } from 'bun:test';
import { Connector, DEFAULT_BASE_URL } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Headers;
}

function installFetch() {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
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

describe('Zapier API Platform client', () => {
  test('listItems uses default base URL and Bearer auth', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'zapier-api-platform-key' });
    await client.items.list();
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/items`);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer zapier-api-platform-key');
  });

  test('getItem encodes item ID in path', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'zapier-api-platform-key' });
    await client.items.get('item-1');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/items/item-1`);
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer zapier-api-platform-key');
  });

  test('createItem POSTs JSON body to /items', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'zapier-api-platform-key' });
    await client.items.create({ name: 'example' });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/items`);
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer zapier-api-platform-key');
  });

  test('listEvents hits /events', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'zapier-api-platform-key' });
    await client.events.list();
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/events`);
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer zapier-api-platform-key');
  });

  test('search POSTs to /search', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'zapier-api-platform-key' });
    await client.search.search({ query: 'test' });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/search`);
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer zapier-api-platform-key');
  });

  test('custom base URL override', async () => {
    const recorded = installFetch();
    const client = new Connector({
      apiKey: 'zapier-api-platform-key',
      baseUrl: 'https://custom.example.com/v2',
    });
    await client.items.list();
    expect(recorded[0].url).toBe('https://custom.example.com/v2/items');
  });

  test('requires API key', () => {
    expect(() => new Connector({})).toThrow('Zapier API Platform API key is required');
  });
});
