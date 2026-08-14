import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TrellistechClient } from './client';
import { TrellistechApiError } from '../types';

describe('TrellistechClient', () => {
  const mockConfig = {
    apiKey: 'trls_test_api_key_12345',
    workspaceId: 'haven-vacation-rentals',
    baseUrl: 'https://app.trellistech.com/api/v1',
  };

  describe('constructor', () => {
    test('throws when api key is missing', () => {
      expect(() => new TrellistechClient({ apiKey: '', workspaceId: 'ws' })).toThrow('API key is required');
    });

    test('throws when workspace ID is missing', () => {
      expect(() => new TrellistechClient({ apiKey: 'trls_key', workspaceId: '' })).toThrow('Workspace ID is required');
    });

    test('creates client with valid config', () => {
      const client = new TrellistechClient(mockConfig);
      expect(client).toBeInstanceOf(TrellistechClient);
      expect(client.workspaceId).toBe('haven-vacation-rentals');
    });
  });

  describe('workspacePath', () => {
    test('prefixes resource with workspace segment', () => {
      const client = new TrellistechClient(mockConfig);
      expect(client.workspacePath('/properties')).toBe('/workspaces/haven-vacation-rentals/properties');
    });
  });

  describe('request methods', () => {
    let client: TrellistechClient;
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      client = new TrellistechClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    const getFetchMock = () => global.fetch as unknown as ReturnType<typeof mock>;

    test('get() uses base URL, workspace path, and Bearer auth', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ items: [], pagination: {} })),
        } as Response)
      ) as unknown as typeof fetch;

      await client.get(client.workspacePath('/properties'));

      const [url, options] = getFetchMock().mock.calls[0];
      expect(url).toBe('https://app.trellistech.com/api/v1/workspaces/haven-vacation-rentals/properties');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer trls_test_api_key_12345');
      expect(options.headers.Accept).toBe('application/json');
    });

    test('post() sends JSON body', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ property: { id: 'p1' } })),
        } as Response)
      ) as unknown as typeof fetch;

      const body = { name: 'Casa Duomo' };
      await client.post(client.workspacePath('/properties'), body);

      const [, options] = getFetchMock().mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('patch() and put() and delete() use correct methods', async () => {
      const mockResponse = () =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response);

      global.fetch = mock(mockResponse) as unknown as typeof fetch;
      await client.patch('/workspaces/ws/properties/p1', { name: 'Updated' });
      expect(getFetchMock().mock.calls[0][1].method).toBe('PATCH');

      global.fetch = mock(mockResponse) as unknown as typeof fetch;
      await client.put('/workspaces/ws/properties/p1', { name: 'Replaced' });
      expect(getFetchMock().mock.calls[0][1].method).toBe('PUT');

      global.fetch = mock(mockResponse) as unknown as typeof fetch;
      await client.delete('/workspaces/ws/properties/p1');
      expect(getFetchMock().mock.calls[0][1].method).toBe('DELETE');
    });

    test('throws TrellistechApiError on 4xx', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'not_found', message: 'Property not found' })),
        } as Response)
      ) as unknown as typeof fetch;

      await expect(client.get('/workspaces/ws/properties/missing')).rejects.toThrow(TrellistechApiError);
    });
  });
});
