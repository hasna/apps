import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { UsebidflowClient } from './client';
import { UsebidflowApiError } from '../types';

describe('UsebidflowClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://api.usebidflow.com/v1',
  };

  describe('constructor', () => {
    test('throws error when apiKey is missing', () => {
      expect(() => new UsebidflowClient({ apiKey: '' })).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new UsebidflowClient(mockConfig);
      expect(client).toBeInstanceOf(UsebidflowClient);
    });

    test('uses default base URL when not provided', () => {
      const client = new UsebidflowClient({ apiKey: 'key' });
      expect(client.getBaseUrl()).toBe('https://api.usebidflow.com/v1');
    });
  });

  describe('request methods', () => {
    let client: UsebidflowClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new UsebidflowClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() makes GET request with Bearer authorization', async () => {
      const mockResponse = { bids: [] };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );

      const result = await client.get('/bids');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.usebidflow.com/v1/bids');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer test-api-key-12345');
      expect(options.headers.Accept).toBe('application/json');
      expect(result).toEqual(mockResponse);
    });

    test('get() builds URL for bid by id', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ id: 'item-1' })),
        } as Response),
      );

      await client.get('/bids/item-1');

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.usebidflow.com/v1/bids/item-1');
    });

    test('get() appends query parameters', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response),
      );

      await client.get('/bids', { page: 1, limit: 25 });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('page=1');
      expect(url).toContain('limit=25');
    });

    test('post() makes POST request with JSON body', async () => {
      const mockResponse = { id: 'bid-1' };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );

      const body = { title: 'New bid', amount: 100 };
      const result = await client.post('/bids', body);

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
      expect(result).toEqual(mockResponse);
    });

    test('post() sends search payload to /search', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ results: [] })),
        } as Response),
      );

      await client.post('/search', { query: 'widgets' });

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.usebidflow.com/v1/search');
      expect(options.body).toBe(JSON.stringify({ query: 'widgets' }));
    });

    test('throws UsebidflowApiError on error response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'invalid_key' })),
        } as Response),
      );

      await expect(client.get('/bids')).rejects.toThrow(UsebidflowApiError);
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

      const result = await client.request('/bids/1', { method: 'DELETE' });
      expect(result).toEqual({});
    });
  });
});
