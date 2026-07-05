import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { WhopClient } from './client';
import { WhopApiError } from '../types';

describe('WhopClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://api.whop.com/api/v1',
    apiVersionDate: '2026-06-20',
  };

  describe('constructor', () => {
    test('throws error when api key is missing', () => {
      expect(() => new WhopClient({ apiKey: '' })).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new WhopClient(mockConfig);
      expect(client).toBeInstanceOf(WhopClient);
    });
  });

  describe('getApiKeyPreview', () => {
    test('returns masked key for long keys', () => {
      const client = new WhopClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('test-a...2345');
    });

    test('returns *** for short keys', () => {
      const client = new WhopClient({ ...mockConfig, apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
    });
  });

  describe('request methods', () => {
    let client: WhopClient;
    let originalFetch: typeof global.fetch;
    let fetchMock: ReturnType<typeof mock>;

    beforeEach(() => {
      client = new WhopClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() makes GET request with Bearer auth and Api-Version-Date', async () => {
      const mockResponse = { data: [] };
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await client.get('/memberships', { company_id: 'biz_test' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.whop.com/api/v1/memberships?company_id=biz_test');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer test-api-key-12345');
      expect(options.headers['Api-Version-Date']).toBe('2026-06-20');
      expect(result).toEqual(mockResponse);
    });

    test('get() appends array query parameters', async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.get('/memberships', { statuses: ['active', 'trialing'] });

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('statuses=active');
      expect(url).toContain('statuses=trialing');
    });

    test('post() sends JSON body', async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"id":"mem_1"}'),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const body = { days: 7 };
      await client.post('/memberships/mem_1/add_free_days', body);

      const [, options] = fetchMock.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('throws WhopApiError on 4xx response', async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error: { type: 'not_found', message: 'Missing' } })),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(client.get('/memberships/missing')).rejects.toThrow(WhopApiError);
    });

    test('retries on 429 then succeeds', async () => {
      let calls = 0;
      fetchMock = mock(() => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            headers: new Headers({ 'retry-after': '0' }),
            text: () => Promise.resolve(''),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"ok":true}'),
        } as Response);
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await client.request('/products', {
        method: 'GET',
        params: { company_id: 'biz_test' },
        retries: 1,
      });
      expect(result).toEqual({ ok: true });
      expect(calls).toBe(2);
    });

    test('handles 204 No Content', async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await client.delete('/webhooks/wh_1');
      expect(result).toEqual({});
    });
  });
});
