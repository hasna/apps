import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient } from './client';
import { ConnectorApiError } from '../types';

describe('ConnectorClient', () => {
  const mockConfig = {
    apiKey: 'test-api-token-12345',
    baseUrl: 'https://test.app.unleash-hosted.com/instance/api',
    projectId: 'default',
  };

  describe('constructor', () => {
    test('throws error when API key is missing', () => {
      expect(() => new ConnectorClient({})).toThrow('API key or token is required');
    });

    test('creates client with valid config', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client).toBeInstanceOf(ConnectorClient);
      expect(client.projectId).toBe('default');
    });

    test('uses default base URL when not provided', () => {
      const client = new ConnectorClient({ apiKey: 'token' });
      expect(client).toBeInstanceOf(ConnectorClient);
    });
  });

  describe('getApiKeyPreview', () => {
    test('returns masked token for long tokens', () => {
      const client = new ConnectorClient(mockConfig);
      const preview = client.getApiKeyPreview();
      expect(preview).toBe('test-a...2345');
    });

    test('returns *** for short tokens', () => {
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
      const mockResponse = { features: [] };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );

      const result = await client.get('/admin/projects/default/features');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://test.app.unleash-hosted.com/instance/api/admin/projects/default/features');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer test-api-token-12345');
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

      await client.get('/admin/events', { limit: 50, project: 'default' });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('limit=50');
      expect(url).toContain('project=default');
    });

    test('post() makes POST request with JSON body', async () => {
      const mockResponse = { name: 'new-flag', type: 'release' };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );

      const body = { name: 'new-flag', type: 'release' };
      const result = await client.post('/admin/projects/default/features', body);

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
          text: () => Promise.resolve(JSON.stringify({ message: 'Feature not found' })),
        } as Response)
      );

      await expect(client.get('/admin/projects/default/features/missing')).rejects.toThrow(ConnectorApiError);
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

      const result = await client.delete('/admin/projects/default/features/old-flag');
      expect(result).toEqual({});
    });
  });
});
