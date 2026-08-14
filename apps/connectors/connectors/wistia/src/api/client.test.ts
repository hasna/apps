import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { WistiaClient } from './client';
import { WistiaApiError } from '../types';

describe('WistiaClient', () => {
  const mockConfig = {
    apiToken: 'test-wistia-token-12345',
    baseUrl: 'https://api.wistia.com',
  };

  describe('constructor', () => {
    test('throws when API token is missing', () => {
      expect(() => new WistiaClient({})).toThrow('Wistia API token is required');
    });

    test('creates client with valid config', () => {
      const client = new WistiaClient(mockConfig);
      expect(client).toBeInstanceOf(WistiaClient);
    });
  });

  describe('getApiTokenPreview', () => {
    test('masks long tokens', () => {
      const client = new WistiaClient(mockConfig);
      expect(client.getApiTokenPreview()).toBe('test-w...2345');
    });

    test('returns *** for short tokens', () => {
      const client = new WistiaClient({ apiToken: 'short' });
      expect(client.getApiTokenPreview()).toBe('***');
    });
  });

  describe('request methods', () => {
    let client: WistiaClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new WistiaClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() sends Bearer auth to Wistia account endpoint', async () => {
      const mockResponse = { id: 1, name: 'Acme' };
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await client.get('/v1/account.json');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.wistia.com/v1/account.json');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer test-wistia-token-12345');
      expect(options.headers.Accept).toBe('application/json');
      expect(result).toEqual(mockResponse);
    });

    test('get() appends query parameters', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('[]'),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.get('/v1/projects.json', { page: 2, per_page: 25 });

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('page=2');
      expect(url).toContain('per_page=25');
    });

    test('post() sends JSON body for project create', async () => {
      const body = { name: 'Launch' };
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ hashedId: 'abc123' })),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.post('/v1/projects.json', body);

      const [, options] = fetchMock.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('throws WistiaApiError on 401 response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'Invalid token' })),
        } as Response),
      ) as unknown as typeof fetch;

      await expect(client.get('/v1/account.json')).rejects.toThrow(WistiaApiError);
    });

    test('handles 204 No Content', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response),
      ) as unknown as typeof fetch;

      const result = await client.delete('/v1/projects/abc.json');
      expect(result).toEqual({});
    });
  });
});
