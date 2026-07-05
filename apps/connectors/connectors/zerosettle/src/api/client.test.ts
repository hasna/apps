import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ZeroSettleClient, DEFAULT_BASE_URL, encodePathSegment } from './client';
import { ZeroSettleApiError } from '../types';

describe('ZeroSettleClient', () => {
  const mockConfig = {
    publishableKey: 'zs_pk_test_zero',
    baseUrl: 'https://api.zerosettle.io',
  };

  describe('constructor', () => {
    test('throws when publishable key is missing', () => {
      expect(() => new ZeroSettleClient({ publishableKey: '' })).toThrow('Publishable key is required');
    });

    test('uses default base URL when not provided', () => {
      const client = new ZeroSettleClient({ publishableKey: 'zs_pk_test' });
      expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
    });

    test('strips trailing slash from base URL', () => {
      const client = new ZeroSettleClient({
        publishableKey: 'zs_pk_test',
        baseUrl: 'https://api.zerosettle.io/',
      });
      expect(client.getBaseUrl()).toBe('https://api.zerosettle.io');
    });
  });

  describe('encodePathSegment', () => {
    test('encodes spaces in path segments', () => {
      expect(encodePathSegment('txn 1')).toBe('txn%201');
      expect(encodePathSegment('sub 1')).toBe('sub%201');
    });
  });

  describe('request methods', () => {
    let client: ZeroSettleClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new ZeroSettleClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() sends X-ZeroSettle-Key header', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"products":[]}'),
        } as Response),
      ) as unknown as typeof fetch;

      await client.get('/v1/iap/products/');

      const [url, options] = (global.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.zerosettle.io/v1/iap/products/');
      expect(options.method).toBe('GET');
      expect(options.headers['X-ZeroSettle-Key']).toBe('zs_pk_test_zero');
    });

    test('get() appends query parameters', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response),
      ) as unknown as typeof fetch;

      await client.get('/v1/iap/entitlements/', { user_id: 'user 1' });

      const [url] = (global.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.zerosettle.io/v1/iap/entitlements/?user_id=user+1');
    });

    test('post() sends JSON body', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"id":"pi_1"}'),
        } as Response),
      ) as unknown as typeof fetch;

      const body = { product_id: 'pro_monthly', user_id: 'user 1' };
      await client.post('/v1/iap/payment-intents/', body);

      const [, options] = (global.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('request() sends JSON body with DELETE', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"ok":true}'),
        } as Response),
      ) as unknown as typeof fetch;

      const body = { reason: 'duplicate' };
      await client.request('/v1/iap/custom/', { method: 'DELETE', body });

      const [, options] = (global.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('DELETE');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('throws ZeroSettleApiError on error responses', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Invalid API key' })),
        } as Response),
      ) as unknown as typeof fetch;

      await expect(client.get('/v1/iap/products/')).rejects.toThrow(ZeroSettleApiError);
    });

    test('handles 204 No Content', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response),
      ) as unknown as typeof fetch;

      const result = await client.request('/v1/iap/restore/', { method: 'POST', body: { user_id: 'u1' } });
      expect(result).toEqual({});
    });
  });
});
