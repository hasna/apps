import { afterEach, describe, expect, test } from 'bun:test';
import { ConnectorClient, DEFAULT_BASE_URL } from './client';
import { ItemsApi } from './items';
import { ConnectorApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown,
): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : (init.headers as Record<string, string>);
      Object.assign(headers, h);
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers });
    const json = handler(url, init, recorded);
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

describe('ConnectorClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://custom.example.com/v1',
  };

  test('throws when api key is missing', () => {
    expect(() => new ConnectorClient({})).toThrow('API key or token is required');
  });

  test('uses default base URL when not provided', () => {
    const client = new ConnectorClient({ apiKey: 'key' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  test('uses custom base URL when provided', () => {
    const client = new ConnectorClient(mockConfig);
    expect(client.getBaseUrl()).toBe('https://custom.example.com/v1');
  });

  test('sends Bearer authorization header on GET', async () => {
    const recorded = installFetch(() => []);
    const client = new ConnectorClient(mockConfig);
    await client.get('/items');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://custom.example.com/v1/items');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.Authorization).toBe('Bearer test-api-key-12345');
  });

  test('appends query parameters', async () => {
    const recorded = installFetch(() => ({}));
    const client = new ConnectorClient(mockConfig);
    await client.get('/items', { limit: 10, page: 2 });

    expect(recorded[0].url).toContain('limit=10');
    expect(recorded[0].url).toContain('page=2');
  });

  test('throws ConnectorApiError on 4xx response', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ error: 'Unauthorized' }),
      }) as Response) as unknown as typeof fetch;

    const client = new ConnectorClient(mockConfig);
    await expect(client.get('/items')).rejects.toThrow(ConnectorApiError);
  });
});

describe('ItemsApi', () => {
  test('listItems calls GET /items on default base URL', async () => {
    const recorded = installFetch(() => [{ id: '1' }]);
    const client = new ConnectorClient({ apiKey: 'key' });
    const items = new ItemsApi(client);
    const result = await items.list();

    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/items`);
    expect(recorded[0].headers.Authorization).toBe('Bearer key');
    expect(result).toEqual([{ id: '1' }]);
  });

  test('getItem calls GET /items/:itemId with encoded id', async () => {
    const recorded = installFetch(() => ({ id: 'abc/def' }));
    const client = new ConnectorClient({ apiKey: 'key' });
    const items = new ItemsApi(client);
    await items.get('abc/def');

    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/items/abc%2Fdef`);
  });
});
