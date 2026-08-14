import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TogglClient } from './client';
import { TogglApiError } from '../types';

describe('TogglClient', () => {
  const mockConfig = {
    apiToken: 'test-api-token-12345',
    baseUrl: 'https://api.track.toggl.com/api/v9',
  };

  describe('constructor', () => {
    test('throws error when apiToken is missing', () => {
      expect(() => new TogglClient({ apiToken: '' })).toThrow('API token is required');
    });

    test('creates client with valid config', () => {
      const client = new TogglClient(mockConfig);
      expect(client).toBeInstanceOf(TogglClient);
    });
  });

  describe('getApiTokenPreview', () => {
    test('returns masked token for long tokens', () => {
      const client = new TogglClient(mockConfig);
      const preview = client.getApiTokenPreview();
      expect(preview).toBe('test-a...2345');
    });

    test('returns *** for short tokens', () => {
      const client = new TogglClient({ ...mockConfig, apiToken: 'short' });
      expect(client.getApiTokenPreview()).toBe('***');
    });
  });

  describe('auth header', () => {
    test('encodes Basic auth with token:api_token', () => {
      const client = new TogglClient(mockConfig);
      const header = client.getAuthHeader();
      expect(header).toMatch(/^Basic /);
      const encoded = header.replace('Basic ', '');
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
      expect(decoded).toBe('test-api-token-12345:api_token');
    });
  });

  describe('request methods', () => {
    let client: TogglClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new TogglClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() makes GET request with correct headers', async () => {
      const mockResponse = { id: 1, email: 'user@example.com' };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );

      const result = await client.get('/me');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.track.toggl.com/api/v9/me');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toMatch(/^Basic /);
      expect(options.headers.Accept).toBe('application/json');
      expect(result).toEqual(mockResponse);
    });

    test('get() appends query parameters and array values', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('[]'),
        } as Response)
      );

      await client.get('/workspaces/1/projects', {
        page: 1,
        user_ids: ['10', '20'],
        active: undefined,
      });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('page=1');
      expect(url).toContain('user_ids=10');
      expect(url).toContain('user_ids=20');
      expect(url).not.toContain('active');
    });

    test('post() makes POST request with body', async () => {
      const mockResponse = { id: 42, name: 'New Project' };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );

      const body = { name: 'New Project' };
      const result = await client.post('/workspaces/1/projects', body);

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
      expect(result).toEqual(mockResponse);
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

      const result = await client.delete('/workspaces/1/projects/2');
      expect(result).toEqual({});
    });

    test('throws TogglApiError on 4xx response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Invalid API token' })),
        } as Response)
      );

      await expect(client.get('/me')).rejects.toThrow(TogglApiError);
    });

    test('throws TogglApiError on 5xx response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'Server error' })),
        } as Response)
      );

      try {
        await client.get('/me');
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TogglApiError);
        expect((error as TogglApiError).statusCode).toBe(500);
      }
    });
  });
});
