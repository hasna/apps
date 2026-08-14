import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { WebexClient, WEBEX_API_BASE } from './client';
import { WebexApiError } from '../types';

describe('WebexClient', () => {
  const mockConfig = {
    accessToken: 'test-access-token-12345',
    baseUrl: WEBEX_API_BASE,
  };

  describe('constructor', () => {
    test('throws error when access token is missing', () => {
      expect(() => new WebexClient({ accessToken: '' })).toThrow('Webex access token is required');
    });

    test('creates client with valid config', () => {
      const client = new WebexClient(mockConfig);
      expect(client).toBeInstanceOf(WebexClient);
    });
  });

  describe('getAccessTokenPreview', () => {
    test('returns masked token for long tokens', () => {
      const client = new WebexClient(mockConfig);
      const preview = client.getAccessTokenPreview();
      expect(preview).toBe('test-a...2345');
    });

    test('returns *** for short tokens', () => {
      const client = new WebexClient({ accessToken: 'short' });
      expect(client.getAccessTokenPreview()).toBe('***');
    });
  });

  describe('request methods', () => {
    let client: WebexClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new WebexClient(mockConfig);
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
        } as Response),
      );

      const result = await client.get('/rooms');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe(`${WEBEX_API_BASE}/rooms`);
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer test-access-token-12345');
      expect(result).toEqual(mockResponse);
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

      await client.get('/rooms', { type: 'group', max: 10 });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('type=group');
      expect(url).toContain('max=10');
    });

    test('post() makes POST request with body', async () => {
      const mockResponse = { id: 'room-1', title: 'Test' };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );

      const body = { title: 'Test Room' };
      const result = await client.post('/rooms', body);

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
      expect(result).toEqual(mockResponse);
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

      await client.delete('/rooms/abc');

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe(`${WEBEX_API_BASE}/rooms/abc`);
      expect(options.method).toBe('DELETE');
    });

    test('throws WebexApiError on 4xx response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Room not found' })),
        } as Response),
      );

      await expect(client.get('/rooms/missing')).rejects.toThrow(WebexApiError);
    });

    test('filters out undefined query params', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response),
      );

      await client.get('/rooms', { max: 5, type: undefined });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('max=5');
      expect(url).not.toContain('type');
    });
  });
});
