import { afterEach, describe, expect, test } from 'bun:test';
import { Connector, ConnectorClient, DEFAULT_BASE_URL } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: Recorded) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const entry: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);
    const json = handler(entry);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Webhook API client', () => {
  test('requires API key', () => {
    expect(() => new ConnectorClient({})).toThrow('Webhook API key is required');
  });

  test('uses default base URL and Bearer auth for list hooks', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe(`${DEFAULT_BASE_URL}/hooks`);
      expect(entry.method).toBe('GET');
      expect(entry.headers.authorization).toBe('Bearer test-key');
      return { hooks: [] };
    });

    const client = new Connector({ apiKey: 'test-key' });
    await client.hooks.list();
    expect(recorded).toHaveLength(1);
  });

  test('get hook uses encoded path', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe(`${DEFAULT_BASE_URL}/hooks/item-1`);
      expect(entry.headers.authorization).toBe('Bearer webhook-key');
      return { id: 'item-1' };
    });

    const client = new Connector({ apiKey: 'webhook-key' });
    await client.hooks.get('item-1');
    expect(recorded).toHaveLength(1);
  });

  test('create hook POSTs JSON body', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe(`${DEFAULT_BASE_URL}/hooks`);
      expect(entry.method).toBe('POST');
      expect(entry.body).toBe(JSON.stringify({ name: 'new-hook', url: 'https://example.com/hook' }));
      return { id: 'hook-1' };
    });

    const client = new Connector({ apiKey: 'test-key' });
    await client.hooks.create({ name: 'new-hook', url: 'https://example.com/hook' });
    expect(recorded).toHaveLength(1);
  });

  test('search POSTs to /search', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe(`${DEFAULT_BASE_URL}/search`);
      expect(entry.method).toBe('POST');
      expect(entry.body).toBe(JSON.stringify({ query: 'invoice' }));
      return { results: [] };
    });

    const client = new Connector({ apiKey: 'test-key' });
    await client.search.search({ query: 'invoice' });
    expect(recorded).toHaveLength(1);
  });

  test('supports custom base URL override', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe('https://custom.example/v2/hooks');
      return { hooks: [] };
    });

    const client = new Connector({ apiKey: 'test-key', baseUrl: 'https://custom.example/v2' });
    await client.hooks.list();
    expect(recorded).toHaveLength(1);
  });

  test('list events GET /events', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe(`${DEFAULT_BASE_URL}/events`);
      expect(entry.method).toBe('GET');
      return { events: [] };
    });

    const client = new Connector({ apiKey: 'test-key' });
    await client.events.list();
    expect(recorded).toHaveLength(1);
  });
});
