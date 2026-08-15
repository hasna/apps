import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { SprigClient } from './client';
import { PurgeApi } from './resources';
import { SprigApiError } from '../types';

describe('SprigClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://api.sprig.com',
  };

  describe('constructor', () => {
    test('throws error when apiKey is missing', () => {
      expect(() => new SprigClient({})).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new SprigClient(mockConfig);
      expect(client).toBeInstanceOf(SprigClient);
    });
  });

  describe('getApiKeyPreview', () => {
    test('returns masked key for long keys', () => {
      const client = new SprigClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('test-a...2345');
    });

    test('returns *** for short keys', () => {
      const client = new SprigClient({ apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
    });
  });

  describe('request', () => {
    let client: SprigClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new SprigClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('v1 GET uses Bearer auth header', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ data: [] })),
        } as Response),
      ) as unknown as typeof fetch;

      await client.get('/v1/surveys', undefined, 'bearer');

      const [, options] = (global.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      expect(options.headers.Authorization).toBe('Bearer test-api-key-12345');
    });

    test('v2 POST uses API-Key auth header', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 202,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response),
      ) as unknown as typeof fetch;

      await client.post('/v2/users', { userId: 'u1' }, undefined, 'api-key', [202]);

      const [, options] = (global.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('API-Key test-api-key-12345');
    });

    test('purge resource uses Bearer auth header', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ requestId: 'req_123' })),
        } as Response),
      ) as unknown as typeof fetch;

      await new PurgeApi(client).visitors({ emails: ['user@example.com'] });

      const [url, options] = (global.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.sprig.com/v2/purge/visitors');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer test-api-key-12345');
    });

    test('treats 202 Accepted as success for upsert', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 202,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response),
      ) as unknown as typeof fetch;

      const result = await client.post('/v2/users', { userId: 'u1' }, undefined, 'api-key', [202]);
      expect(result).toEqual({ accepted: true, status: 202 });
    });

    test('throws SprigApiError on 400 with error body', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'Invalid userId' })),
        } as Response),
      ) as unknown as typeof fetch;

      await expect(client.get('/v2/users/bad')).rejects.toThrow(SprigApiError);
    });

    test('retries on 429 rate limit', async () => {
      let calls = 0;
      global.fetch = mock(() => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Headers({ 'retry-after': '0' }),
            text: () => Promise.resolve(''),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ data: [] })),
        } as Response);
      }) as unknown as typeof fetch;

      const result = await client.get('/v1/surveys');
      expect(calls).toBe(2);
      expect(result).toEqual({ data: [] });
    });

    test('appends array query params for status filter', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response),
      ) as unknown as typeof fetch;

      await client.get('/v1/surveys', { status: ['PAUSED', 'COMPLETED'] });

      const [url] = (global.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('status=PAUSED');
      expect(url).toContain('status=COMPLETED');
    });
  });
});
