import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient } from './client';
import { ConnectorApiError } from '../types';

describe('ConnectorClient', () => {
  const mockConfig = {
    apiKey: 'sk_test_1234567890abcdef',
    baseUrl: 'https://api.stripe.com/v1',
  };

  describe('constructor', () => {
    test('throws when API key is missing', () => {
      expect(() => new ConnectorClient({ apiKey: '' })).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client).toBeInstanceOf(ConnectorClient);
    });

    test('requires account ID for org API keys', () => {
      expect(() => new ConnectorClient({ apiKey: 'sk_org_test123' })).toThrow('Account ID is required');
    });
  });

  describe('getApiKeyPreview', () => {
    test('masks long API keys', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('sk_tes...cdef');
    });
  });

  describe('request', () => {
    let client: ConnectorClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new ConnectorClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('sends Bearer auth and Stripe-Version headers', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"object":"list","data":[]}'),
        } as Response),
      );

      await client.get('/webhook_endpoints');

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.stripe.com/v1/webhook_endpoints');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer sk_test_1234567890abcdef');
      expect(options.headers['Stripe-Version']).toBeDefined();
    });

    test('encodes POST body as form-urlencoded', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"id":"we_123"}'),
        } as Response),
      );

      await client.post('/webhook_endpoints', {
        url: 'https://example.com/hook',
        enabled_events: ['invoice.paid', 'customer.created'],
        metadata: { env: 'test' },
      });

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(options.body).toContain('url=https%3A%2F%2Fexample.com%2Fhook');
      expect(options.body).toContain('enabled_events%5B0%5D=invoice.paid');
      expect(options.body).toContain('metadata%5Benv%5D=test');
    });

    test('throws ConnectorApiError on non-2xx responses', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"error":{"message":"Invalid API Key"}}'),
        } as Response),
      );

      await expect(client.get('/webhook_endpoints')).rejects.toThrow(ConnectorApiError);
    });

    test('handles 204 No Content', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response),
      );

      const result = await client.delete('/webhook_endpoints/we_123');
      expect(result).toEqual({});
    });
  });
});
