import { afterEach, describe, expect, test } from 'bun:test';
import { ConnectorClient } from './client';
import { Connector } from './index';

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
    const client = new Connector({ apiKey: 'test-api-key', baseUrl: 'https://configured.example.com/v1' });
    await client.listItems();
    expect(recorded[0].url).toBe(`https://configured.example.com/v1/items`);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization || recorded[0].headers.Authorization).toBe('Bearer test-api-key');
  });

  test('encodes item IDs in getItem path', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'test-api-key', baseUrl: 'https://configured.example.com/v1' });
    await client.getItem('item/with/slash');
    expect(recorded[0].url).toBe(`https://configured.example.com/v1/items/${encodeURIComponent('item/with/slash')}`);
  });

  test('posts search body to /search', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'test-api-key', baseUrl: 'https://configured.example.com/v1' });
    await client.search({ query: 'hello', limit: 5 });
    expect(recorded[0].url).toBe(`https://configured.example.com/v1/search`);
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

  test('refuses to send without a configured base URL (no default endpoint)', () => {
    expect(() => new ConnectorClient({ apiKey: 'test-key' })).toThrow(/baseUrl/);
  });

  test('sends the API key only to the configured base URL', async () => {
    const recorded: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      recorded.push(typeof input === 'string' ? input : input.toString());
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        async text() { return JSON.stringify({ ok: true }); },
        async json() { return { ok: true }; },
      } as Response;
    }) as typeof fetch;
    const client = new ConnectorClient({ apiKey: 'test-key', baseUrl: 'https://configured.example.com/v1' });
    await client.request('/ping');
    expect(recorded).toHaveLength(1);
    expect(recorded[0].startsWith('https://configured.example.com/v1/')).toBe(true);
    expect(recorded[0]).not.toContain('api.weaviateapiplatform.com');
  });
});
