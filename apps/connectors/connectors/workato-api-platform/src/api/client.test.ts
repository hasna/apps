import { afterEach, describe, expect, test } from 'bun:test';
import { Connector } from './index';
const TEST_BASE_URL = 'https://tenant.example.com/v1';

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

describe('Workato API Platform client', () => {
  test('listItems sends Bearer auth and GET /items', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.method).toBe('GET');
      expect(entry.url).toBe(`${TEST_BASE_URL}/items`);
      expect(entry.headers.authorization).toBe('Bearer test-api-key');
      return { items: [] };
    });

    const connector = new Connector({ apiKey: 'test-api-key', baseUrl: TEST_BASE_URL });
    const result = await connector.items.list();
    expect(result).toEqual({ items: [] });
    expect(recorded).toHaveLength(1);
  });

  test('getItem encodes item ID and calls GET /items/:id', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.method).toBe('GET');
      expect(entry.url).toBe(`${TEST_BASE_URL}/items/item%2F123`);
      expect(entry.headers.authorization).toBe('Bearer test-api-key');
      return { id: 'item/123' };
    });

    const connector = new Connector({ apiKey: 'test-api-key', baseUrl: TEST_BASE_URL });
    const result = await connector.items.get('item/123');
    expect(result).toEqual({ id: 'item/123' });
    expect(recorded).toHaveLength(1);
  });

  test('createItem POSTs JSON body to /items', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.method).toBe('POST');
      expect(entry.url).toBe(`${TEST_BASE_URL}/items`);
      expect(entry.body).toBe(JSON.stringify({ name: 'widget' }));
      return { id: 'new-item' };
    });

    const connector = new Connector({ apiKey: 'test-api-key', baseUrl: TEST_BASE_URL });
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

  test('requires API key', () => {
    expect(() => new Connector({})).toThrow('API key or token is required');
  });

  test('requires base URL', () => {
    expect(() => new Connector({ apiKey: 'test-api-key' })).toThrow('baseUrl is required');
  });
});
