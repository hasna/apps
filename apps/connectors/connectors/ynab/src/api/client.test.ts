import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { YnabClient } from './client';
import { YnabApiError } from '../types';

describe('YnabClient', () => {
  const mockConfig = {
    accessToken: 'test-access-token-12345',
    baseUrl: 'https://api.ynab.com/v1',
  };

  describe('constructor', () => {
    test('throws error when access token is missing', () => {
      expect(() => new YnabClient({ accessToken: '' })).toThrow('Access token is required');
    });

    test('creates client with valid config', () => {
      const client = new YnabClient(mockConfig);
      expect(client).toBeInstanceOf(YnabClient);
    });

    test('uses default base URL when not provided', () => {
      const client = new YnabClient({ accessToken: 'token' });
      expect(client).toBeInstanceOf(YnabClient);
    });
  });

  describe('getAccessTokenPreview', () => {
    test('returns masked token for long tokens', () => {
      const client = new YnabClient(mockConfig);
      const preview = client.getAccessTokenPreview();
      expect(preview).toBe('test-a...2345');
    });

    test('returns *** for short tokens', () => {
      const client = new YnabClient({ ...mockConfig, accessToken: 'short' });
      const preview = client.getAccessTokenPreview();
      expect(preview).toBe('***');
    });
  });

  describe('request methods', () => {
    let client: YnabClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new YnabClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() makes GET request with Bearer auth header', async () => {
      const mockResponse = { data: { user: { id: 'user-uuid' } } };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );

      const result = await client.get('/user');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.ynab.com/v1/user');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer test-access-token-12345');
      expect(options.headers.Accept).toBe('application/json');
      expect(result).toEqual(mockResponse);
    });

    test('get() appends query parameters', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"data":{"plans":[]}}'),
        } as Response),
      );

      await client.get('/plans', { include_accounts: true });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('include_accounts=true');
    });

    test('post() makes POST request with body', async () => {
      const mockResponse = { data: { transaction: { id: 'tx-1' } } };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );

      const body = { transaction: { account_id: 'acc-1', date: '2026-01-01', amount: -10000 } };
      const result = await client.post('/plans/plan-1/transactions', body);

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
      expect(result).toEqual(mockResponse);
    });

    test('put() makes PUT request', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"data":{"transaction":{}}}'),
        } as Response),
      );

      await client.put('/plans/plan-1/transactions/tx-1', { transaction: { memo: 'updated' } });

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('PUT');
    });

    test('patch() makes PATCH request', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"data":{}}'),
        } as Response),
      );

      await client.patch('/plans/plan-1/categories/cat-1', { category: { name: 'Updated' } });

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('PATCH');
    });

    test('delete() makes DELETE request', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response),
      );

      await client.delete('/plans/plan-1/transactions/tx-1');

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('DELETE');
    });

    test('handles 204 No Content response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response),
      );

      const result = await client.delete('/plans/plan-1/transactions/tx-1');
      expect(result).toEqual({});
    });

    test('throws YnabApiError on 4xx response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                error: { id: '404', name: 'not_found', detail: 'Plan not found' },
              }),
            ),
        } as Response),
      );

      await expect(client.get('/plans/missing')).rejects.toThrow(YnabApiError);
    });

    test('throws YnabApiError on 5xx response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                error: { id: '500', name: 'internal_error', detail: 'Server error' },
              }),
            ),
        } as Response),
      );

      try {
        await client.get('/user');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(YnabApiError);
        expect((err as YnabApiError).statusCode).toBe(500);
        expect((err as YnabApiError).error?.detail).toBe('Server error');
      }
    });

    test('filters out undefined/null query params', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"data":{"transactions":[]}}'),
        } as Response),
      );

      await client.get('/plans/plan-1/transactions', {
        since_date: '2026-01-01',
        until_date: undefined,
        type: null as unknown as string,
      });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('since_date=2026-01-01');
      expect(url).not.toContain('until_date');
      expect(url).not.toContain('type');
    });

    test('builds URL with path prefix', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"data":{"user":{}}}'),
        } as Response),
      );

      await client.get('user');

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.ynab.com/v1/user');
    });
  });
});
