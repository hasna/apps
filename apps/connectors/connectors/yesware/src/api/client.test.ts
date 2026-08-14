import { afterEach, describe, expect, test } from 'bun:test';
import { YeswareClient } from './client';
import { YeswareApiError } from '../types';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => {
    ok: boolean;
    status: number;
    body?: unknown;
    contentType?: string;
  }
): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      Object.assign(headers, h);
    }
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const result = handler(url, init);
    const text = result.body !== undefined ? JSON.stringify(result.body) : '';
    return {
      ok: result.ok,
      status: result.status,
      statusText: result.ok ? 'OK' : 'Error',
      headers: new Headers({ 'content-type': result.contentType ?? 'application/json' }),
      async text() {
        return text;
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('YeswareClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://api.yesware.com/v1',
  };

  describe('constructor', () => {
    test('throws error when apiKey is missing', () => {
      expect(() => new YeswareClient({ apiKey: '' })).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new YeswareClient(mockConfig);
      expect(client).toBeInstanceOf(YeswareClient);
    });

    test('uses default base URL when not provided', () => {
      const client = new YeswareClient({ apiKey: 'test-key' });
      expect(client).toBeInstanceOf(YeswareClient);
    });
  });

  describe('getApiKeyPreview', () => {
    test('returns masked key for long keys', () => {
      const client = new YeswareClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('test-a...2345');
    });

    test('returns *** for short keys', () => {
      const client = new YeswareClient({ ...mockConfig, apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
    });
  });

  describe('request methods', () => {
    test('get() sends Bearer auth and hits /sequences', async () => {
      const recorded = installFetch(() => ({
        ok: true,
        status: 200,
        body: [{ id: 'seq-1', name: 'Outreach' }],
      }));
      const client = new YeswareClient(mockConfig);
      const result = await client.get('/sequences');

      expect(recorded).toHaveLength(1);
      expect(recorded[0].url).toBe('https://api.yesware.com/v1/sequences');
      expect(recorded[0].method).toBe('GET');
      expect(recorded[0].headers.Authorization).toBe('Bearer test-api-key-12345');
      expect(recorded[0].headers.Accept).toBe('application/json');
      expect(result).toEqual([{ id: 'seq-1', name: 'Outreach' }]);
    });

    test('get() appends query parameters', async () => {
      const recorded = installFetch(() => ({ ok: true, status: 200, body: [] }));
      const client = new YeswareClient(mockConfig);
      await client.get('/events', { limit: 10, offset: 5 });

      expect(recorded[0].url).toContain('limit=10');
      expect(recorded[0].url).toContain('offset=5');
    });

    test('get() encodes sequence id in path', async () => {
      const recorded = installFetch(() => ({ ok: true, status: 200, body: { id: 'seq/1' } }));
      const client = new YeswareClient(mockConfig);
      await client.get('/sequences/seq%2F1');

      expect(recorded[0].url).toBe('https://api.yesware.com/v1/sequences/seq%2F1');
    });

    test('post() makes POST request to /search with body', async () => {
      const recorded = installFetch(() => ({
        ok: true,
        status: 200,
        body: { results: [], total: 0 },
      }));
      const client = new YeswareClient(mockConfig);
      const body = { query: 'opens:last-7-days' };
      const result = await client.post('/search', body);

      expect(recorded[0].url).toBe('https://api.yesware.com/v1/search');
      expect(recorded[0].method).toBe('POST');
      expect(recorded[0].headers['Content-Type']).toBe('application/json');
      expect(recorded[0].body).toBe(JSON.stringify(body));
      expect(result).toEqual({ results: [], total: 0 });
    });

    test('post() creates sequence via POST /sequences', async () => {
      const recorded = installFetch(() => ({
        ok: true,
        status: 201,
        body: { id: 'new-seq', name: 'Follow up' },
      }));
      const client = new YeswareClient(mockConfig);
      await client.post('/sequences', { name: 'Follow up' });

      expect(recorded[0].url).toBe('https://api.yesware.com/v1/sequences');
      expect(recorded[0].method).toBe('POST');
      expect(recorded[0].body).toBe(JSON.stringify({ name: 'Follow up' }));
    });

    test('handles 204 No Content response', async () => {
      installFetch(() => ({ ok: true, status: 204 }));
      const client = new YeswareClient(mockConfig);
      const result = await client.request('/sequences/1', { method: 'DELETE' });
      expect(result).toEqual({});
    });

    test('throws YeswareApiError on error response', async () => {
      installFetch(() => ({
        ok: false,
        status: 401,
        body: { message: 'Invalid API key' },
      }));
      const client = new YeswareClient(mockConfig);
      await expect(client.get('/sequences')).rejects.toThrow(YeswareApiError);
    });
  });
});
