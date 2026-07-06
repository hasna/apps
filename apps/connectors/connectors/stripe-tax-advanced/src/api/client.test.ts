import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient } from './client';
import { ConnectorApiError } from '../types';

describe('ConnectorClient', () => {
  const mockConfig = {
    apiKey: 'sk_test_1234567890abcdef',
    baseUrl: 'https://api.stripe.com/v1',
    accountId: 'acct_test123',
  };

  describe('constructor', () => {
    test('throws error when API key is missing', () => {
      expect(() => new ConnectorClient({ apiKey: '' })).toThrow('API key is required');
    });

    test('throws error for org key without account ID', () => {
      expect(() => new ConnectorClient({ apiKey: 'sk_org_abc123' })).toThrow('Account ID is required');
    });

    test('creates client with valid config', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client).toBeInstanceOf(ConnectorClient);
    });
  });

  describe('getApiKeyPreview', () => {
    test('returns masked key for long keys', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('sk_tes...cdef');
    });

    test('returns *** for short keys', () => {
      const client = new ConnectorClient({ ...mockConfig, apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
    });
  });

  describe('request methods', () => {
    let client: ConnectorClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new ConnectorClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() makes GET request with Stripe auth headers', async () => {
      const mockResponse = { object: 'tax.settings', status: 'active' };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );

      const result = await client.get('/tax/settings');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.stripe.com/v1/tax/settings');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer sk_test_1234567890abcdef');
      expect(options.headers['Stripe-Version']).toBeDefined();
      expect(options.headers['Stripe-Context']).toBe('acct_test123');
      expect(result).toEqual(mockResponse);
    });

    test('post() encodes body as form-urlencoded', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"id":"taxcalc_123"}'),
        } as Response)
      );

      await client.post('/tax/calculations', {
        currency: 'usd',
        line_items: [{ amount: 1000, reference: 'item-1' }],
      });

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(options.body).toContain('currency=usd');
      expect(options.body).toContain('line_items');
      expect(options.body).toContain('amount');
    });

    test('get() appends query parameters', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"data":[]}'),
        } as Response)
      );

      await client.get('/tax/registrations', { limit: 10, status: 'active' });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('limit=10');
      expect(url).toContain('status=active');
    });

    test('throws ConnectorApiError on error response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error: { message: 'Invalid request' } })),
        } as Response)
      );

      await expect(client.get('/tax/settings')).rejects.toThrow(ConnectorApiError);
    });

    test('handles 204 No Content', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response)
      );

      const result = await client.get('/tax/settings');
      expect(result).toEqual({});
    });
  });
});
