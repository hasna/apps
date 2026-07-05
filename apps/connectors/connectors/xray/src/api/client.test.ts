import { describe, test, expect, afterEach } from 'bun:test';
import { ConnectorClient, DEFAULT_BASE_URL } from './client';
import { Connector } from './index';
import { ConnectorApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
}

function installFetch(handler: () => unknown): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers,
      body: init?.body ?? null,
    });
    const json = handler();
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
    apiKey: 'xray-test-key-12345',
    baseUrl: 'https://api.xray.com/v1',
  };

  describe('constructor', () => {
    test('throws error when API key is missing', () => {
      expect(() => new ConnectorClient({})).toThrow('Xray API key is required');
    });

    test('creates client with valid config', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client).toBeInstanceOf(ConnectorClient);
      expect(client.getBaseUrl()).toBe('https://api.xray.com/v1');
    });

    test('uses default base URL when not provided', () => {
      const client = new ConnectorClient({ apiKey: 'test-key' });
      expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
    });

    test('strips trailing slash from base URL', () => {
      const client = new ConnectorClient({ apiKey: 'test-key', baseUrl: 'https://api.xray.com/v1/' });
      expect(client.getBaseUrl()).toBe('https://api.xray.com/v1');
    });
  });

  describe('request methods', () => {
    test('get() lists scans with Bearer auth', async () => {
      const mockResponse = [{ id: 'scan-1' }];
      const recorded = installFetch(() => mockResponse);
      const client = new ConnectorClient(mockConfig);

      const result = await client.get('/scans');

      expect(result).toEqual(mockResponse);
      expect(recorded).toHaveLength(1);
      expect(recorded[0].url).toBe('https://api.xray.com/v1/scans');
      expect(recorded[0].method).toBe('GET');
      expect(new Headers(recorded[0].headers).get('Authorization')).toBe('Bearer xray-test-key-12345');
    });

    test('get() fetches scan by id', async () => {
      const mockResponse = { id: 'item-1', name: 'Test scan' };
      const recorded = installFetch(() => mockResponse);
      const client = new ConnectorClient(mockConfig);

      const result = await client.get('/scans/item-1');

      expect(result).toEqual(mockResponse);
      expect(recorded[0].url).toBe('https://api.xray.com/v1/scans/item-1');
    });

    test('post() sends search body with Bearer auth', async () => {
      const mockResponse = { results: [] };
      const recorded = installFetch(() => mockResponse);
      const client = new ConnectorClient(mockConfig);
      const body = { query: 'regression' };

      const result = await client.post('/search', body);

      expect(result).toEqual(mockResponse);
      expect(recorded[0].url).toBe('https://api.xray.com/v1/search');
      expect(recorded[0].method).toBe('POST');
      expect(recorded[0].body).toBe(JSON.stringify(body));
      expect(new Headers(recorded[0].headers).get('Authorization')).toBe('Bearer xray-test-key-12345');
      expect(new Headers(recorded[0].headers).get('Content-Type')).toBe('application/json');
    });

    test('request() sends DELETE body when provided', async () => {
      const mockResponse = { deleted: true };
      const recorded = installFetch(() => mockResponse);
      const client = new ConnectorClient(mockConfig);
      const body = { reason: 'cleanup' };

      const result = await client.request('/scans/item-1', { method: 'DELETE', body });

      expect(result).toEqual(mockResponse);
      expect(recorded[0].method).toBe('DELETE');
      expect(recorded[0].body).toBe(JSON.stringify(body));
      expect(new Headers(recorded[0].headers).get('Content-Type')).toBe('application/json');
    });

    test('throws ConnectorApiError on API error response', async () => {
      globalThis.fetch = (async () =>
        ({
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          async text() {
            return JSON.stringify({ message: 'Unauthorized' });
          },
        }) as Response) as unknown as typeof fetch;

      const client = new ConnectorClient(mockConfig);
      await expect(client.get('/scans')).rejects.toThrow(ConnectorApiError);
    });

    test('throws timeout message after AbortError', async () => {
      globalThis.fetch = (async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }) as typeof fetch;

      const client = new ConnectorClient(mockConfig);
      await expect(client.request('/scans', { retries: 0, timeout: 5 })).rejects.toThrow('Request timeout after 5ms');
    });
  });
});

describe('Connector', () => {
  test('scans.list calls /scans', async () => {
    const recorded = installFetch(() => ({ ok: true }));
    const connector = new Connector({ apiKey: 'xray-key' });
    await connector.scans.list();
    expect(recorded[0].url).toBe('https://api.xray.com/v1/scans');
  });

  test('scans.get encodes scan id in path', async () => {
    const recorded = installFetch(() => ({ id: 'item-1' }));
    const connector = new Connector({ apiKey: 'xray-key' });
    await connector.scans.get('item-1');
    expect(recorded[0].url).toBe('https://api.xray.com/v1/scans/item-1');
  });

  test('search.search POSTs to /search', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const connector = new Connector({ apiKey: 'xray-key' });
    await connector.search.search({ query: 'test' });
    expect(recorded[0].url).toBe('https://api.xray.com/v1/search');
    expect(recorded[0].method).toBe('POST');
  });
});
