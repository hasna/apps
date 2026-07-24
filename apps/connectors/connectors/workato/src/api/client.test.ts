import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { WorkatoClient, DEFAULT_BASE_URL, validateBaseUrl } from './client';
import { WorkatoApiError } from '../types';

describe('WorkatoClient', () => {
  const mockConfig = {
    apiToken: 'workato-token-12345',
    baseUrl: 'https://workato.example/api/v3',
  };

  describe('constructor', () => {
    test('throws when api token is missing', () => {
      expect(() => new WorkatoClient({ apiToken: '' })).toThrow('Workato API token is required');
    });

    test('creates client with valid config', () => {
      const client = new WorkatoClient(mockConfig);
      expect(client).toBeInstanceOf(WorkatoClient);
      expect(client.getBaseUrl()).toBe('https://workato.example/api/v3');
    });

    test('uses default base URL when not provided', () => {
      const client = new WorkatoClient({ apiToken: 'token' });
      expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
    });

    test('rejects non-HTTPS base URL', () => {
      expect(() => new WorkatoClient({ apiToken: 'token', baseUrl: 'http://workato.example/api' }))
        .toThrow('Workato base URL must start with https://');
    });
  });

  describe('validateBaseUrl', () => {
    test('strips trailing slashes', () => {
      expect(validateBaseUrl('https://workato.example/api/')).toBe('https://workato.example/api');
    });
  });

  describe('getApiTokenPreview', () => {
    test('masks long tokens', () => {
      const client = new WorkatoClient(mockConfig);
      expect(client.getApiTokenPreview()).toBe('workat...2345');
    });

    test('returns *** for short tokens', () => {
      const client = new WorkatoClient({ apiToken: 'short' });
      expect(client.getApiTokenPreview()).toBe('***');
    });
  });

  describe('request methods', () => {
    let client: WorkatoClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new WorkatoClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() sends Bearer auth and Accept header', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"ok":true}'),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await client.get('/users');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0] as unknown as [string, {
        method: string;
        headers: Record<string, string>;
        body?: string;
      }];
      const url = (fetchMock.mock.calls[0] as unknown as [string])[0];
      expect(url).toBe('https://workato.example/api/v3/users');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer workato-token-12345');
      expect(options.headers.Accept).toBe('application/json');
      expect(result).toEqual({ ok: true });
    });

    test('get() appends snake_case query parameters', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.get('/recipes', { folder_id: 10, per_page: 20, page: 2 });

      const [url] = fetchMock.mock.calls[0] as unknown as [string];
      expect(url).toContain('folder_id=10');
      expect(url).toContain('per_page=20');
      expect(url).toContain('page=2');
    });

    test('post() sends JSON body with Content-Type', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"id":1}'),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.post('/connections', { name: 'CRM', provider: 'salesforce' });

      const [, options] = fetchMock.mock.calls[0] as unknown as [string, {
        method: string;
        headers: Record<string, string>;
        body?: string;
      }];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(options.body!)).toEqual({ name: 'CRM', provider: 'salesforce' });
    });

    test('throws WorkatoApiError on API error response', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"message":"Unauthorized"}'),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(client.get('/users')).rejects.toThrow(WorkatoApiError);
    });
  });
});
