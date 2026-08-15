import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient } from './client';
import { ConnectorApiError } from '../types';
import { CampaignsApi } from './campaigns';

describe('ConnectorClient', () => {
  const mockConfig = {
    apiToken: 'test-api-token-12345',
    accountId: '123456',
    baseUrl: 'https://app.vwo.com/api/v2',
  };

  describe('constructor', () => {
    test('throws error when apiToken is missing', () => {
      expect(() => new ConnectorClient({ accountId: '123' })).toThrow('API token is required');
    });

    test('throws error when accountId is missing', () => {
      expect(() => new ConnectorClient({ apiToken: 'token' })).toThrow('Account ID is required');
    });

    test('creates client with valid config', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client).toBeInstanceOf(ConnectorClient);
    });

    test('accepts token alias', () => {
      const client = new ConnectorClient({ token: 'token', accountId: '123' });
      expect(client).toBeInstanceOf(ConnectorClient);
    });
  });

  describe('getApiTokenPreview', () => {
    test('returns masked token for long tokens', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client.getApiTokenPreview()).toBe('test-a...2345');
    });

    test('returns *** for short tokens', () => {
      const client = new ConnectorClient({ ...mockConfig, apiToken: 'short' });
      expect(client.getApiTokenPreview()).toBe('***');
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

    test('get() sends token and X-Account-ID headers', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ campaigns: [] })),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.get('/campaigns');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string> }];
      const [url, options] = call;
      expect(url).toBe('https://app.vwo.com/api/v2/campaigns');
      expect(options.method).toBe('GET');
      expect(options.headers.token).toBe('test-api-token-12345');
      expect(options.headers['X-Account-ID']).toBe('123456');
      expect(options.headers.Accept).toBe('application/json');
    });

    test('get() appends query parameters', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.get('/campaigns', { limit: 10, offset: 0 });

      const call = fetchMock.mock.calls[0] as unknown as [string, unknown];
      const [url] = call;
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=0');
    });

    test('throws ConnectorApiError with VWO _error shape', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ _error: { message: 'Invalid campaign' } })),
        } as Response),
      ) as unknown as typeof fetch;

      try {
        await client.get('/campaigns/1');
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConnectorApiError);
        expect((error as ConnectorApiError).message).toBe('Invalid campaign');
        expect((error as ConnectorApiError).statusCode).toBe(400);
      }
    });

    test('handles 204 No Content response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response),
      ) as unknown as typeof fetch;

      const result = await client.delete('/campaigns/1');
      expect(result).toEqual({});
    });
  });
});

describe('CampaignsApi', () => {
  test('list() calls campaigns endpoint', async () => {
    const mockGet = mock(() => Promise.resolve({ items: [] }));
    const api = new CampaignsApi({ get: mockGet } as unknown as ConnectorClient);

    await api.list({ limit: 5 });

    expect(mockGet).toHaveBeenCalledWith('/campaigns', { limit: 5 });
  });
});
