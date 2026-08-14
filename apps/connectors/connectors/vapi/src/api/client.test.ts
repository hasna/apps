import { afterEach, describe, expect, test } from 'bun:test';
import { VapiClient } from './client';
import { VapiApiError } from '../types';

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
    statusText?: string;
    body?: unknown;
    contentType?: string;
  }
): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });

    const result = handler(url, init);
    const contentType = result.contentType ?? 'application/json';
    const text = result.body === undefined ? '' : JSON.stringify(result.body);

    return {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText ?? (result.ok ? 'OK' : 'Error'),
      headers: new Headers({ 'content-type': contentType }),
      text: async () => text,
    } as Response;
  }) as typeof fetch;

  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('VapiClient', () => {
  const mockConfig = {
    apiKey: 'test-vapi-api-key-12345',
    baseUrl: 'https://api.vapi.ai',
  };

  describe('constructor', () => {
    test('throws error when apiKey is missing', () => {
      expect(() => new VapiClient({ apiKey: '' })).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new VapiClient(mockConfig);
      expect(client).toBeInstanceOf(VapiClient);
    });
  });

  describe('getApiKeyPreview', () => {
    test('returns masked key for long keys', () => {
      const client = new VapiClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('test-v...2345');
    });

    test('returns *** for short keys', () => {
      const client = new VapiClient({ ...mockConfig, apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
    });
  });

  describe('request methods', () => {
    test('get() makes GET request with Bearer auth', async () => {
      const recorded = installFetch(() => ({
        ok: true,
        status: 200,
        body: [{ id: 'asst-1' }],
      }));

      const client = new VapiClient(mockConfig);
      const result = await client.get('/assistant');

      expect(recorded).toHaveLength(1);
      expect(recorded[0].url).toBe('https://api.vapi.ai/assistant');
      expect(recorded[0].method).toBe('GET');
      expect(recorded[0].headers.authorization).toBe('Bearer test-vapi-api-key-12345');
      expect(recorded[0].headers.accept).toBe('application/json');
      expect(result).toEqual([{ id: 'asst-1' }]);
    });

    test('get() appends query parameters', async () => {
      const recorded = installFetch(() => ({
        ok: true,
        status: 200,
        body: [],
      }));

      const client = new VapiClient(mockConfig);
      await client.get('/assistant', { limit: 5, createdAtGt: undefined });

      expect(recorded[0].url).toContain('limit=5');
      expect(recorded[0].url).not.toContain('createdAtGt');
    });

    test('post() makes POST request with JSON body', async () => {
      const recorded = installFetch(() => ({
        ok: true,
        status: 201,
        body: { id: 'asst-2', name: 'Test' },
      }));

      const client = new VapiClient(mockConfig);
      const body = { name: 'Test' };
      const result = await client.post('/assistant', body);

      expect(recorded[0].method).toBe('POST');
      expect(recorded[0].headers['content-type']).toBe('application/json');
      expect(recorded[0].body).toBe(JSON.stringify(body));
      expect(result).toEqual({ id: 'asst-2', name: 'Test' });
    });

    test('handles 204 No Content response', async () => {
      installFetch(() => ({
        ok: true,
        status: 204,
        contentType: 'text/plain',
      }));

      const client = new VapiClient(mockConfig);
      const result = await client.request('/assistant/1', { method: 'DELETE' });
      expect(result).toEqual({});
    });

    test('throws VapiApiError on error response', async () => {
      installFetch(() => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        body: { message: 'Invalid API key' },
      }));

      const client = new VapiClient(mockConfig);
      await expect(client.get('/assistant')).rejects.toThrow(VapiApiError);
    });

    test('uses custom base URL when provided', async () => {
      const recorded = installFetch(() => ({
        ok: true,
        status: 200,
        body: [],
      }));

      const client = new VapiClient({
        apiKey: 'key',
        baseUrl: 'https://custom.vapi.example',
      });
      await client.get('/tool');

      expect(recorded[0].url).toBe('https://custom.vapi.example/tool');
    });
  });
});
