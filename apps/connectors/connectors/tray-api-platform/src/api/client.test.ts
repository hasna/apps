import { afterEach, describe, expect, test } from 'bun:test';
import { Connector } from './index';
import { DEFAULT_BASE_URL } from './client';

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
    const rawHeaders = init?.headers;
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    } else if (Array.isArray(rawHeaders)) {
      for (const [key, value] of rawHeaders) {
        headers[key.toLowerCase()] = value;
      }
    } else if (rawHeaders) {
      for (const [key, value] of Object.entries(rawHeaders)) {
        headers[key.toLowerCase()] = value;
      }
    }

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

describe('Tray API Platform client', () => {
  test('listItems sends Bearer auth and GET /items', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.method).toBe('GET');
      expect(entry.url).toBe(`${DEFAULT_BASE_URL}/items`);
      expect(entry.headers.authorization).toBe('Bearer test-api-key');
      return { items: [] };
    });

    const connector = new Connector({ apiKey: 'test-api-key' });
    const result = await connector.items.list();
    expect(result).toEqual({ items: [] });
    expect(recorded).toHaveLength(1);
  });

  test('getItem encodes item ID and calls GET /items/:id', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.method).toBe('GET');
      expect(entry.url).toBe(`${DEFAULT_BASE_URL}/items/item%2F123`);
      expect(entry.headers.authorization).toBe('Bearer test-api-key');
      return { id: 'item/123' };
    });

    const connector = new Connector({ apiKey: 'test-api-key' });
    const result = await connector.items.get('item/123');
    expect(result).toEqual({ id: 'item/123' });
    expect(recorded).toHaveLength(1);
  });

  test('createItem POSTs JSON body to /items', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.method).toBe('POST');
      expect(entry.url).toBe(`${DEFAULT_BASE_URL}/items`);
      expect(entry.body).toBe(JSON.stringify({ name: 'widget' }));
      return { id: 'new-item' };
    });

    const connector = new Connector({ apiKey: 'test-api-key' });
    await connector.items.create({ name: 'widget' });
    expect(recorded).toHaveLength(1);
  });

  test('uses configurable base URL override', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe('https://tenant.example.com/v1/events');
      return { events: [] };
    });

    const connector = new Connector({
      apiKey: 'test-api-key',
      baseUrl: 'https://tenant.example.com/v1/',
    });
    await connector.events.list();
    expect(recorded).toHaveLength(1);
  });

  test('listEvents sends GET /events', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.method).toBe('GET');
      expect(entry.url).toBe(`${DEFAULT_BASE_URL}/events`);
      expect(entry.headers.authorization).toBe('Bearer test-api-key');
      return { events: [] };
    });

    const connector = new Connector({ apiKey: 'test-api-key' });
    const result = await connector.events.list();
    expect(result).toEqual({ events: [] });
    expect(recorded).toHaveLength(1);
  });

  test('search POSTs JSON body to /search', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.method).toBe('POST');
      expect(entry.url).toBe(`${DEFAULT_BASE_URL}/search`);
      expect(entry.body).toBe(JSON.stringify({ query: 'widget' }));
      return { results: [] };
    });

    const connector = new Connector({ apiKey: 'test-api-key' });
    const result = await connector.search.search({ query: 'widget' });
    expect(result).toEqual({ results: [] });
    expect(recorded).toHaveLength(1);
  });

  test('rawRequest supports custom path and method', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.method).toBe('POST');
      expect(entry.url).toBe(`${DEFAULT_BASE_URL}/custom/path`);
      expect(entry.body).toBe(JSON.stringify({ action: 'ping' }));
      return { ok: true };
    });

    const connector = new Connector({ apiKey: 'test-api-key' });
    const result = await connector.rawRequest({
      method: 'POST',
      path: '/custom/path',
      body: { action: 'ping' },
    });
    expect(result).toEqual({ ok: true });
    expect(recorded).toHaveLength(1);
  });

  test('requires API key', () => {
    expect(() => new Connector({})).toThrow('API key or token is required');
  });
});
