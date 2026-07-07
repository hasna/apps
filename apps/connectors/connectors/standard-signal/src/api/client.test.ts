import { afterEach, describe, expect, test } from 'bun:test';
import { StandardSignalClient } from './client';
import { StandardSignalApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function installFetch(handler: (url: string, init: RequestInit | undefined) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => {
        headers[key] = value;
      });
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers });
    const json = handler(url, init);
    if (json === 'error') {
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'application/json' }),
        async text() {
          return JSON.stringify({ message: 'Invalid API key' });
        },
      } as Response;
    }
    return {
      ok: true,
      status: 200,
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

describe('StandardSignalClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://api.standardsignal.com/v1',
  };

  test('throws error when apiKey is missing', () => {
    expect(() => new StandardSignalClient({ apiKey: '' })).toThrow('Standard Signal API key is required');
  });

  test('creates client with valid config', () => {
    const client = new StandardSignalClient(mockConfig);
    expect(client).toBeInstanceOf(StandardSignalClient);
    expect(client.getBaseUrl()).toBe('https://api.standardsignal.com/v1');
  });

  test('strips trailing slash from base URL', () => {
    const client = new StandardSignalClient({
      ...mockConfig,
      baseUrl: 'https://api.standardsignal.com/v1/',
    });
    expect(client.getBaseUrl()).toBe('https://api.standardsignal.com/v1');
  });

  test('getApiKeyPreview masks long keys', () => {
    const client = new StandardSignalClient(mockConfig);
    expect(client.getApiKeyPreview()).toBe('test-a...2345');
  });

  test('getApiKeyPreview returns *** for short keys', () => {
    const client = new StandardSignalClient({ ...mockConfig, apiKey: 'short' });
    expect(client.getApiKeyPreview()).toBe('***');
  });

  test('GET /portfolios uses Bearer auth and correct URL', async () => {
    const recorded = installFetch(() => ({ portfolios: [] }));
    const client = new StandardSignalClient(mockConfig);
    const result = await client.request('/portfolios');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.standardsignal.com/v1/portfolios');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization).toBe('Bearer test-api-key-12345');
    expect(result).toEqual({ portfolios: [] });
  });

  test('GET /performance uses Bearer auth and correct URL', async () => {
    const recorded = installFetch(() => ({ performance: { return: 0.12 } }));
    const client = new StandardSignalClient(mockConfig);
    const result = await client.request('/performance');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.standardsignal.com/v1/performance');
    expect(recorded[0].headers.authorization).toBe('Bearer test-api-key-12345');
    expect(result).toEqual({ performance: { return: 0.12 } });
  });

  test('appends query parameters', async () => {
    const recorded = installFetch(() => ({}));
    const client = new StandardSignalClient(mockConfig);
    await client.request('/portfolios', { params: { limit: 10, offset: 0 } });

    expect(recorded[0].url).toContain('limit=10');
    expect(recorded[0].url).toContain('offset=0');
  });

  test('throws StandardSignalApiError on error response', async () => {
    installFetch(() => 'error');
    const client = new StandardSignalClient(mockConfig);
    await expect(client.request('/portfolios')).rejects.toThrow(StandardSignalApiError);
  });
});
