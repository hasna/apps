import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { SteelDevClient } from './client';
import { SteelDevApiError } from '../types';

describe('SteelDevClient', () => {
  const mockConfig = {
    apiKey: 'ste-test-api-key-12345',
    baseUrl: 'https://api.steel.dev/v1',
  };

  describe('constructor', () => {
    test('throws error when apiKey is missing', () => {
      expect(() => new SteelDevClient({ apiKey: '' })).toThrow('Steel API key is required');
    });

    test('creates client with valid config', () => {
      const client = new SteelDevClient(mockConfig);
      expect(client).toBeInstanceOf(SteelDevClient);
    });

    test('uses default base URL when not provided', () => {
      const client = new SteelDevClient({ apiKey: 'ste-key' });
      expect(client.getBaseUrl()).toBe('https://api.steel.dev/v1');
    });

    test('strips trailing slash from base URL', () => {
      const client = new SteelDevClient({
        apiKey: 'ste-key',
        baseUrl: 'https://api.steel.dev/v1/',
      });
      expect(client.getBaseUrl()).toBe('https://api.steel.dev/v1');
    });
  });

  describe('getAuthHeaders', () => {
    test('uses steel-api-key header per official docs', () => {
      const client = new SteelDevClient(mockConfig);
      const headers = client.getAuthHeaders();
      expect(headers['steel-api-key']).toBe(mockConfig.apiKey);
      expect(headers.Authorization).toBeUndefined();
    });
  });

  describe('getApiKeyPreview', () => {
    test('returns masked key for long keys', () => {
      const client = new SteelDevClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('ste-...2345');
    });

    test('returns *** for short keys', () => {
      const client = new SteelDevClient({ apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
    });
  });

  describe('request methods', () => {
    let client: SteelDevClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new SteelDevClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() calls GET /sessions with steel-api-key header', async () => {
      const mockResponse = { sessions: [{ id: 'sess-1' }] };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );

      const result = await client.get('/sessions');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.steel.dev/v1/sessions');
      expect(options.method).toBe('GET');
      expect(options.headers['steel-api-key']).toBe(mockConfig.apiKey);
      expect(result).toEqual(mockResponse);
    });

    test('get() calls GET /sessions/:id', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ id: 'abc-123' })),
        } as Response),
      );

      await client.get('/sessions/abc-123');

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.steel.dev/v1/sessions/abc-123');
    });

    test('post() creates session at POST /sessions', async () => {
      const mockResponse = { id: 'new-session', status: 'live' };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );

      const body = { useProxy: true };
      const result = await client.post('/sessions', body);

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.steel.dev/v1/sessions');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
      expect(result).toEqual(mockResponse);
    });

    test('get() fetches session events', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ events: [] })),
        } as Response),
      );

      await client.get('/sessions/sess-1/events');

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.steel.dev/v1/sessions/sess-1/events');
    });

    test('post() scrapes via POST /scrape', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ content: { markdown: '# Hello' } })),
        } as Response),
      );

      const body = { url: 'https://example.com', format: ['markdown'] };
      await client.post('/scrape', body);

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.steel.dev/v1/scrape');
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('throws SteelDevApiError on 401 response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Invalid Steel API Key' })),
        } as Response),
      );

      await expect(client.get('/sessions')).rejects.toThrow(SteelDevApiError);
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

      const result = await client.delete('/sessions/sess-1');
      expect(result).toEqual({});
    });

    test('rawRequest forwards custom method and query params', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response),
      );

      await client.rawRequest({
        method: 'GET',
        path: '/sessions',
        query: { limit: 10, status: 'live' },
      });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/sessions');
      expect(url).toContain('limit=10');
      expect(url).toContain('status=live');
    });
  });
});
