import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { WaitClient } from './client';
import { WaitApiError } from '../types';

describe('WaitClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://api.wait.com/v1',
  };

  describe('constructor', () => {
    test('throws error when apiKey is missing', () => {
      expect(() => new WaitClient({ apiKey: '' })).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new WaitClient(mockConfig);
      expect(client).toBeInstanceOf(WaitClient);
    });
  });

  describe('request methods', () => {
    let client: WaitClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new WaitClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('listDelays makes GET /delays with Bearer auth', async () => {
      const mockResponse = [{ id: 'delay-1' }];
      const mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await client.get('/delays');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0]! as unknown as [string, RequestInit];
      expect(url).toBe('https://api.wait.com/v1/delays');
      expect(options.method).toBe('GET');
      expect((options.headers as Record<string, string>).Authorization).toBe('Bearer test-api-key-12345');
      expect((options.headers as Record<string, string>).Accept).toBe('application/json');
      expect(result).toEqual(mockResponse);
    });

    test('getDelay makes GET /delays/:id with encoded path', async () => {
      const mockResponse = { id: 'delay/abc' };
      const mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await client.get('/delays/delay%2Fabc');

      const [url, options] = mockFetch.mock.calls[0]! as unknown as [string, RequestInit];
      expect(url).toBe('https://api.wait.com/v1/delays/delay%2Fabc');
      expect(options.method).toBe('GET');
      expect((options.headers as Record<string, string>).Authorization).toBe('Bearer test-api-key-12345');
      expect(result).toEqual(mockResponse);
    });

    test('throws WaitApiError on error response', async () => {
      const mockFetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Invalid API key' })),
        } as Response),
      );
      global.fetch = mockFetch as unknown as typeof fetch;

      await expect(client.get('/delays')).rejects.toThrow(WaitApiError);
    });
  });
});
