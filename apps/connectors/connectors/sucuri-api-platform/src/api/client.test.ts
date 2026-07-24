import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient, DEFAULT_BASE_URL } from './client';
import { ConnectorApiError } from '../types';

describe('ConnectorClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://api.sucuriapiplatform.com/v1',
  };

  describe('constructor', () => {
    test('throws error when api key is missing', () => {
      expect(() => new ConnectorClient({})).toThrow('Sucuri API Platform API key is required');
    });

    test('creates client with valid config', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client).toBeInstanceOf(ConnectorClient);
    });

    test('uses default base URL when not provided', () => {
      const client = new ConnectorClient({ apiKey: 'token' });
      expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
    });

    test('strips trailing slash from base URL', () => {
      const client = new ConnectorClient({
        apiKey: 'token',
        baseUrl: 'https://custom.example.com/v1/',
      });
      expect(client.getBaseUrl()).toBe('https://custom.example.com/v1');
    });
  });

  describe('getApiKeyPreview', () => {
    test('returns masked key for long keys', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('test-a...2345');
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

    test('get() makes GET request with Bearer auth', async () => {
      const mockResponse = { items: [] };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );

      const result = await client.get('/items');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.sucuriapiplatform.com/v1/items');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer test-api-key-12345');
      expect(options.headers.Accept).toBe('application/json');
      expect(result).toEqual(mockResponse);
    });

    test('get() appends query parameters', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response)
      );

      await client.get('/items', { limit: 10, page: 2 });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('limit=10');
      expect(url).toContain('page=2');
    });

    test('post() makes POST request with JSON body', async () => {
      const mockResponse = { id: 'item-1' };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );

      const body = { name: 'example' };
      const result = await client.post('/items', body);

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
      expect(result).toEqual(mockResponse);
    });

    test('throws ConnectorApiError on 4xx response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Not found' })),
        } as Response)
      );

      await expect(client.get('/items/missing')).rejects.toThrow(ConnectorApiError);
    });

    test('handles 204 No Content response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response)
      );

      const result = await client.delete('/items/1');
      expect(result).toEqual({});
    });
  });
});
