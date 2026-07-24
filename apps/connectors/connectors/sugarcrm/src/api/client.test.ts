import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient } from './client';
import { ConnectorApiError } from '../types';

describe('ConnectorClient', () => {
  const mockConfig = {
    oauthToken: 'test-oauth-token-12345',
    baseUrl: 'https://example.sugarondemand.com',
  };

  describe('constructor', () => {
    test('throws error when baseUrl is missing', () => {
      expect(() => new ConnectorClient({ oauthToken: 'token', baseUrl: '' })).toThrow('baseUrl is required');
    });

    test('creates client with valid config', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client).toBeInstanceOf(ConnectorClient);
    });

    test('strips trailing slash from baseUrl', () => {
      const client = new ConnectorClient({
        ...mockConfig,
        baseUrl: 'https://example.sugarondemand.com/',
      });
      expect(client.getApiPrefix()).toBe('https://example.sugarondemand.com/rest/v11_24');
    });
  });

  describe('getTokenPreview', () => {
    test('returns masked token for long tokens', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client.getTokenPreview()).toBe('test-o...2345');
    });

    test('returns not set when token missing', () => {
      const client = new ConnectorClient({ baseUrl: mockConfig.baseUrl });
      expect(client.getTokenPreview()).toBe('not set');
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

    test('get() uses OAuth-Token header and correct base URL', async () => {
      const mockResponse = { records: [] };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );

      const result = await client.get('/Accounts');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://example.sugarondemand.com/rest/v11_24/Accounts');
      expect(options.method).toBe('GET');
      expect(options.headers['OAuth-Token']).toBe(mockConfig.oauthToken);
      expect(options.headers.Authorization).toBeUndefined();
      expect(result).toEqual(mockResponse);
    });

    test('post() sends JSON body for module create', async () => {
      const mockResponse = { id: 'abc-123', name: 'Acme' };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );

      const body = { name: 'Acme' };
      const result = await client.post('/Accounts', body);

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify(body));
      expect(result).toEqual(mockResponse);
    });

    test('authenticate skips OAuth-Token header', async () => {
      const tokenResponse = { access_token: 'new-token', expires_in: 3600 };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(tokenResponse)),
        } as Response)
      );

      const clientNoToken = new ConnectorClient({ baseUrl: mockConfig.baseUrl });
      const result = await clientNoToken.post(
        '/oauth2/token',
        {
          grant_type: 'password',
          client_id: 'sugar',
          client_secret: '',
          username: 'user@example.com',
          password: 'secret',
          platform: 'api',
        },
        undefined,
        { skipAuth: true }
      );

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.headers['OAuth-Token']).toBeUndefined();
      expect(result).toEqual(tokenResponse);
    });

    test('throws ConnectorApiError with SugarCRM error_message', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error_message: 'Invalid token.' })),
        } as Response)
      );

      try {
        await client.get('/me');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConnectorApiError);
        expect((err as ConnectorApiError).message).toBe('Invalid token.');
        expect((err as ConnectorApiError).statusCode).toBe(401);
      }
    });
  });
});
