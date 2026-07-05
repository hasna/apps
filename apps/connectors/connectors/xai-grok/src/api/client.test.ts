import { describe, test, expect, afterEach } from 'bun:test';
import { XAIGrokClient } from './client';
import { XAIGrokApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: BodyInit | null;
}

function installFetch(handler: (recorded: Recorded) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) headers[k] = v;
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers, body: init?.body ?? null });
    const json = handler(recorded[recorded.length - 1]);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json ?? {});
      },
      async arrayBuffer() {
        return new Uint8Array([1, 2, 3]).buffer;
      },
    } as Response;
  }) as unknown as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('XAIGrokClient', () => {
  const mockConfig = {
    apiKey: 'xai-test-key-1234567890',
    baseUrl: 'https://api.x.ai/v1',
  };

  describe('constructor', () => {
    test('throws when API key is missing', () => {
      expect(() => new XAIGrokClient({ apiKey: '' })).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new XAIGrokClient(mockConfig);
      expect(client).toBeInstanceOf(XAIGrokClient);
      expect(client.getBaseUrl()).toBe('https://api.x.ai/v1');
    });

    test('strips trailing slash from base URL', () => {
      const client = new XAIGrokClient({ ...mockConfig, baseUrl: 'https://api.x.ai/v1/' });
      expect(client.getBaseUrl()).toBe('https://api.x.ai/v1');
    });
  });

  describe('getApiKeyPreview', () => {
    test('masks long API keys', () => {
      const client = new XAIGrokClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('xai-te...7890');
    });

    test('returns *** for short keys', () => {
      const client = new XAIGrokClient({ apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
    });
  });

  describe('request methods', () => {
    test('get() sends Bearer auth and parses JSON', async () => {
      const recorded = installFetch(() => ({ data: [{ id: 'grok-4' }] }));
      const client = new XAIGrokClient(mockConfig);
      const result = await client.get('/models');

      expect(recorded).toHaveLength(1);
      expect(recorded[0].url).toBe('https://api.x.ai/v1/models');
      expect(recorded[0].method).toBe('GET');
      expect(recorded[0].headers.Authorization).toBe('Bearer xai-test-key-1234567890');
      expect(result).toEqual({ data: [{ id: 'grok-4' }] });
    });

    test('get() appends query parameters', async () => {
      const recorded = installFetch(() => ({}));
      const client = new XAIGrokClient(mockConfig);
      await client.get('/files', { limit: 10, after: 'file_abc' });

      expect(recorded[0].url).toContain('limit=10');
      expect(recorded[0].url).toContain('after=file_abc');
    });

    test('post() sends JSON body with Content-Type', async () => {
      const recorded = installFetch(() => ({ id: 'chatcmpl-1' }));
      const client = new XAIGrokClient(mockConfig);
      const body = { model: 'grok-4', messages: [{ role: 'user', content: 'hi' }] };
      await client.post('/chat/completions', body);

      expect(recorded[0].method).toBe('POST');
      expect(recorded[0].headers['Content-Type']).toBe('application/json');
      expect(recorded[0].body).toBe(JSON.stringify(body));
    });

    test('post() with FormData omits Content-Type header', async () => {
      const recorded = installFetch(() => ({ text: 'hello' }));
      const client = new XAIGrokClient(mockConfig);
      const formData = new FormData();
      formData.append('model', 'whisper-1');
      formData.append('file', new Blob(['audio']), 'test.wav');
      await client.post('/audio/transcriptions', formData);

      expect(recorded[0].headers['Content-Type']).toBeUndefined();
      expect(recorded[0].body).toBe(formData);
    });

    test('delete() handles 204 No Content', async () => {
      globalThis.fetch = (async () =>
        ({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: async () => '',
        }) as Response) as unknown as typeof fetch;
      const client = new XAIGrokClient(mockConfig);
      const result = await client.delete('/files/file_123');
      expect(result).toEqual({});
    });

    test('throws XAIGrokApiError on API error response', async () => {
      globalThis.fetch = (async () =>
        ({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }),
        }) as Response) as unknown as typeof fetch;
      const client = new XAIGrokClient(mockConfig);
      await expect(client.get('/models')).rejects.toThrow(XAIGrokApiError);
    });

    test('getBinary() returns ArrayBuffer on success', async () => {
      const recorded = installFetch(() => ({}));
      const client = new XAIGrokClient(mockConfig);
      const result = await client.getBinary('/files/file_abc/content');
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(recorded[0].url).toContain('/files/file_abc/content');
    });
  });
});
