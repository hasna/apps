import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { UserpilotClient } from './client';
import { UserpilotApiError } from '../types';

describe('UserpilotClient', () => {
  const mockConfig = { apiKey: 'test-api-key-12345678' };

  describe('constructor', () => {
    test('throws error when apiKey is missing', () => {
      expect(() => new UserpilotClient({ apiKey: '' })).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new UserpilotClient(mockConfig);
      expect(client).toBeInstanceOf(UserpilotClient);
    });
  });

  describe('getApiKeyPreview', () => {
    test('returns masked key for long keys', () => {
      const client = new UserpilotClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('test-a...5678');
    });

    test('returns *** for short keys', () => {
      const client = new UserpilotClient({ apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
    });
  });

  describe('request', () => {
    let client: UserpilotClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new UserpilotClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() sends Bearer auth and X-API-Version headers', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ data: [] })),
        } as Response),
      );

      await client.get('/users');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://analytex.userpilot.io/v1/users');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer test-api-key-12345678');
      expect(options.headers['X-API-Version']).toBe('2020-09-22');
    });

    test('post() sends JSON body to /v1 path', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ success: true })),
        } as Response),
      );

      await client.post('/identify', { user_id: 'u1' });

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://analytex.userpilot.io/v1/identify');
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify({ user_id: 'u1' }));
    });

    test('throws UserpilotApiError on failed response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Unauthorized' })),
        } as Response),
      );

      await expect(client.get('/users')).rejects.toThrow(UserpilotApiError);
      await expect(client.get('/users')).rejects.toThrow('Unauthorized');
    });

    test('appends query params to URL', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response),
      );

      await client.get('/users', { page: 2, q: 'alice' });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://analytex.userpilot.io/v1/users?page=2&q=alice');
    });
  });
});
