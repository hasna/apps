import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient, resolveBaseUrl } from './client';
import { ConnectorApiError } from '../types';

describe('ConnectorClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    licenseCode: 'license123',
    dataCenter: 'global' as const,
  };

  describe('resolveBaseUrl', () => {
    test('uses explicit base URL when provided', () => {
      expect(resolveBaseUrl({ baseUrl: 'https://custom.example.com/' })).toBe('https://custom.example.com');
    });

    test('maps global data center', () => {
      expect(resolveBaseUrl({ dataCenter: 'global' })).toBe('https://api.webengage.com');
    });

    test('maps india data center', () => {
      expect(resolveBaseUrl({ dataCenter: 'in' })).toBe('https://api.in.webengage.com');
    });

    test('maps saudi data center', () => {
      expect(resolveBaseUrl({ dataCenter: 'sa' })).toBe('https://api.ksa.webengage.com');
    });

    test('maps europe data center', () => {
      expect(resolveBaseUrl({ dataCenter: 'eug' })).toBe('https://api.eug.webengage.com');
    });
  });

  describe('constructor', () => {
    test('throws when API key is missing', () => {
      expect(() => new ConnectorClient({ licenseCode: 'abc' })).toThrow('API key is required');
    });

    test('throws when license code is missing', () => {
      expect(() => new ConnectorClient({ apiKey: 'key' })).toThrow('License code is required');
    });

    test('creates client with valid config', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client).toBeInstanceOf(ConnectorClient);
      expect(client.getLicenseCode()).toBe('license123');
      expect(client.getBaseUrl()).toBe('https://api.webengage.com');
    });
  });

  describe('accountPath', () => {
    test('builds v1 account-scoped path', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client.accountPath('v1', '/users')).toBe('/v1/accounts/license123/users');
    });

    test('builds v2 experiment transaction path', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client.accountPath('v2', '/experiments/exp1/transaction')).toBe(
        '/v2/accounts/license123/experiments/exp1/transaction'
      );
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

    test('post() uses account-scoped URL and Bearer auth', async () => {
      const mockResponse = { response: { status: 'success' } };
      let capturedUrl = '';
      let capturedOptions: RequestInit | undefined;

      global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedOptions = init;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response;
      }) as unknown as typeof fetch;

      const result = await client.post('/v1/accounts/license123/users', { userId: 'u1' });

      expect(capturedUrl).toBe('https://api.webengage.com/v1/accounts/license123/users');
      expect(capturedOptions?.method).toBe('POST');
      expect((capturedOptions?.headers as Record<string, string>).Authorization).toBe('Bearer test-api-key-12345');
      expect((capturedOptions?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(JSON.parse(capturedOptions?.body as string)).toEqual({ userId: 'u1' });
      expect(result).toEqual(mockResponse);
    });

    test('uses india data center host', async () => {
      const inClient = new ConnectorClient({ ...mockConfig, dataCenter: 'in' });
      let capturedUrl = '';

      global.fetch = (async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response;
      }) as unknown as typeof fetch;

      await inClient.post('/v1/accounts/license123/events', { eventName: 'test' });

      expect(capturedUrl).toBe('https://api.in.webengage.com/v1/accounts/license123/events');
    });

    test('throws ConnectorApiError on 401', async () => {
      global.fetch = (async () => ({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ response: { message: 'Unauthorized' } })),
      })) as unknown as typeof fetch;

      await expect(client.post('/v1/accounts/license123/users', {})).rejects.toThrow(ConnectorApiError);
    });
  });
});
