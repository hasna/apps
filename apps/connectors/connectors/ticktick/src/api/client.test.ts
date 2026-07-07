import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TickTickClient } from './client';
import { TickTickApiError } from '../types';

describe('TickTickClient', () => {
  const mockConfig = {
    accessToken: 'test-access-token-12345',
    baseUrl: 'https://api.ticktick.com/open/v1',
  };

  describe('constructor', () => {
    test('throws error when access token is missing', () => {
      expect(() => new TickTickClient({ accessToken: '' })).toThrow('Access token is required');
    });

    test('creates client with valid config', () => {
      const client = new TickTickClient(mockConfig);
      expect(client).toBeInstanceOf(TickTickClient);
    });
  });

  describe('getAccessTokenPreview', () => {
    test('returns masked token for long tokens', () => {
      const client = new TickTickClient(mockConfig);
      const preview = client.getAccessTokenPreview();
      expect(preview).toBe('test-a...2345');
    });

    test('returns *** for short tokens', () => {
      const client = new TickTickClient({ ...mockConfig, accessToken: 'short' });
      const preview = client.getAccessTokenPreview();
      expect(preview).toBe('***');
    });
  });

  describe('request methods', () => {
    let client: TickTickClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new TickTickClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() makes GET request with Bearer auth', async () => {
      const mockResponse = [{ id: 'p1', name: 'Inbox' }];
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );

      const result = await client.get('/project');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.ticktick.com/open/v1/project');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer test-access-token-12345');
      expect(options.headers.Accept).toBe('application/json');
      expect(result).toEqual(mockResponse);
    });

    test('post() makes POST request with JSON body', async () => {
      const mockResponse = { id: 't1', title: 'Task' };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );

      const body = { title: 'Task', projectId: 'p1' };
      const result = await client.post('/task', body);

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.ticktick.com/open/v1/task');
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

      await client.delete('/project/p1');

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('DELETE');
    });

    test('complete task uses correct path', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response),
      );

      await client.post('/project/p1/task/t1/complete', {});

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.ticktick.com/open/v1/project/p1/task/t1/complete');
    });

    test('throws TickTickApiError on error response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ errorMessage: 'Invalid token' })),
        } as Response),
      );

      await expect(client.get('/project')).rejects.toThrow(TickTickApiError);
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

      const result = await client.delete('/project/p1');
      expect(result).toEqual({});
    });
  });
});
