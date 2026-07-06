import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient } from './client';
import { ConnectorApiError } from '../types';

describe('ConnectorClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://api.terminusapp.com',
    authMode: 'basic' as const,
  };

  describe('constructor', () => {
    test('throws when API key is missing', () => {
      expect(() => new ConnectorClient({})).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client).toBeInstanceOf(ConnectorClient);
    });
  });

  describe('getApiKeyPreview', () => {
    test('masks long API keys', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('test-a...2345');
    });
  });

  describe('request', () => {
    let client: ConnectorClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new ConnectorClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() uses Basic auth and GET /v1/projects/', async () => {
      const mockResponse = { data: [{ id: 'prj_test', name: 'Test' }], meta: { page: 1, has_more: false } };
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await client.get('/v1/projects/');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.terminusapp.com/v1/projects/');
      expect(options.method).toBe('GET');
      const expectedBasic = `Basic ${Buffer.from('test-api-key-12345:').toString('base64')}`;
      expect(options.headers.Authorization).toBe(expectedBasic);
      expect(options.headers.Accept).toBe('application/json');
      expect(result).toEqual(mockResponse);
    });

    test('get() appends page/items query parameters', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"data":[],"meta":{"page":2,"has_more":false}}'),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.get('/v1/projects/', { page: 2, items: 25 });

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('page=2');
      expect(url).toContain('items=25');
    });

    test('bearer auth mode sends Bearer header', async () => {
      const bearerClient = new ConnectorClient({ ...mockConfig, authMode: 'bearer' });
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await bearerClient.get('/v1/projects/');

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
      expect(options.headers.Authorization).toBe('Bearer test-api-key-12345');
    });

    test('post() sends JSON body', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"id":1}'),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const body = { url: 'https://example.com' };
      await client.post('/v1/projects/prj_x/links', body);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string>; body: string }];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('throws ConnectorApiError on 401', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Unauthorized' })),
        } as Response)
      ) as unknown as typeof fetch;

      await expect(client.get('/v1/projects/')).rejects.toThrow(ConnectorApiError);
    });
  });
});
