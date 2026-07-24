import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient } from './client';
import { ConnectorApiError } from '../types';

describe('ConnectorClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://api.wappalyzer.com/v2',
  };

  describe('constructor', () => {
    test('throws when API key is missing', () => {
      expect(() => new ConnectorClient({})).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client).toBeInstanceOf(ConnectorClient);
    });

    test('accepts token alias', () => {
      const client = new ConnectorClient({ token: 'token-value' });
      expect(client).toBeInstanceOf(ConnectorClient);
    });
  });

  describe('getApiKeyPreview', () => {
    test('masks long API keys', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('test-a...2345');
    });

    test('returns *** for short keys', () => {
      const client = new ConnectorClient({ apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
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

    test('sends x-api-key header on GET', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-type': 'application/json',
            'wappalyzer-credits-spent': '1',
            'wappalyzer-credits-remaining': '99',
          }),
          text: () => Promise.resolve('{"credits":99}'),
        } as Response)
      );

      const result = await client.get<{ credits: number }>('/credits/balance/');

      expect(result).toEqual({ credits: 99 });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.wappalyzer.com/v2/credits/balance/');
      expect(options.headers['x-api-key']).toBe('test-api-key-12345');
      expect(client.getLastResponseMeta()).toEqual({ creditsSpent: 1, creditsRemaining: 99 });
    });

    test('appends query parameters', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('[]'),
        } as Response)
      );

      await client.get('/lookup/', {
        urls: 'https://example.com,https://example.org',
        live: true,
        sets: 'company',
      });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('urls=https%3A%2F%2Fexample.com%2Chttps%3A%2F%2Fexample.org');
      expect(url).toContain('live=true');
      expect(url).toContain('sets=company');
    });

    test('throws ConnectorApiError on 403', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Invalid API key' })),
        } as Response)
      );

      await expect(client.get('/lookup/')).rejects.toThrow(ConnectorApiError);
    });

    test('retries on 429 then succeeds', async () => {
      let calls = 0;
      global.fetch = mock(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve('{}'),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"credits":1}'),
        } as Response);
      });

      const result = await client.get<{ credits: number }>('/credits/balance/', undefined);
      expect(result).toEqual({ credits: 1 });
      expect(calls).toBe(2);
    });
  });
});
