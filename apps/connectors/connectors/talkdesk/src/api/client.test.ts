import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TalkdeskClient } from './client';
import { TalkdeskApiError } from '../types';

/** Install a mocked global.fetch and return the mock for call assertions. */
function stubFetch(impl: () => Promise<Response>): ReturnType<typeof mock> {
  const m = mock(impl);
  global.fetch = m as unknown as typeof fetch;
  return m;
}

describe('TalkdeskClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('constructor', () => {
    test('throws when neither token nor client credentials are provided', () => {
      expect(() => new TalkdeskClient({})).toThrow(/credentials are required/);
    });

    test('throws when only clientId is provided', () => {
      expect(() => new TalkdeskClient({ clientId: 'abc' })).toThrow(/credentials are required/);
    });

    test('throws when client credentials are missing an authUrl', () => {
      expect(() => new TalkdeskClient({ clientId: 'id', clientSecret: 'secret' })).toThrow(/authUrl is required/);
    });

    test('creates a client with client credentials and an authUrl', () => {
      expect(new TalkdeskClient({
        clientId: 'id',
        clientSecret: 'secret',
        authUrl: 'https://example.talkdeskid.com/oauth/token',
      })).toBeInstanceOf(TalkdeskClient);
    });

    test('creates a client with a static access token', () => {
      expect(new TalkdeskClient({ accessToken: 'tok' })).toBeInstanceOf(TalkdeskClient);
    });

    test('defaults to the Talkdesk API base URL', () => {
      expect(new TalkdeskClient({ accessToken: 'tok' }).getBaseUrl()).toBe('https://api.talkdeskapp.com');
    });

    test('strips a trailing slash from the base URL', () => {
      const client = new TalkdeskClient({ accessToken: 'tok', baseUrl: 'https://eu.talkdeskapp.com/' });
      expect(client.getBaseUrl()).toBe('https://eu.talkdeskapp.com');
    });
  });

  describe('getAccessToken', () => {
    test('returns a supplied static token without calling the token endpoint', async () => {
      stubFetch(() => Promise.reject(new Error('should not be called')));
      const client = new TalkdeskClient({ accessToken: 'static-token' });
      expect(await client.getAccessToken()).toBe('static-token');
    });

    test('exchanges client credentials for a bearer token via client_credentials grant', async () => {
      const fetchMock = stubFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ access_token: 'fresh-token', token_type: 'Bearer', expires_in: 3600 })),
        } as Response)
      );
      const client = new TalkdeskClient({
        clientId: 'id',
        clientSecret: 'secret',
        authUrl: 'https://example.talkdeskid.com/oauth/token',
      });
      expect(await client.getAccessToken()).toBe('fresh-token');

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
      expect(url).toBe('https://example.talkdeskid.com/oauth/token');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toMatch(/^Basic /);
      expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(options.body).toContain('grant_type=client_credentials');
    });

    test('caches the token across calls', async () => {
      const fetchMock = stubFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ access_token: 'cached', token_type: 'Bearer', expires_in: 3600 })),
        } as Response)
      );
      const client = new TalkdeskClient({
        clientId: 'id',
        clientSecret: 'secret',
        authUrl: 'https://example.talkdeskid.com/oauth/token',
      });
      await client.getAccessToken();
      await client.getAccessToken();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('throws on a failed token exchange', async () => {
      stubFetch(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'invalid_client' })),
        } as Response)
      );
      const client = new TalkdeskClient({
        clientId: 'id',
        clientSecret: 'bad',
        authUrl: 'https://example.talkdeskid.com/oauth/token',
      });
      await expect(client.getAccessToken()).rejects.toThrow(TalkdeskApiError);
    });
  });

  describe('request methods', () => {
    let client: TalkdeskClient;

    beforeEach(() => {
      client = new TalkdeskClient({ accessToken: 'test-token' });
    });

    test('get() sends a Bearer token and parses JSON', async () => {
      const mockResponse = { _embedded: { users: [] } };
      const fetchMock = stubFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );

      const result = await client.get('/users');
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
      expect(url).toBe('https://api.talkdeskapp.com/users');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer test-token');
      expect(result).toEqual(mockResponse);
    });

    test('get() appends query parameters and drops empty ones', async () => {
      const fetchMock = stubFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response)
      );

      await client.get('/users', { page: 2, per_page: undefined });
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain('page=2');
      expect(url).not.toContain('per_page');
    });

    test('post() sends a JSON body with Content-Type', async () => {
      const fetchMock = stubFetch(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"id":"c1"}'),
        } as Response)
      );

      const body = { name: 'Ada' };
      await client.post('/contacts', body);
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('handles 204 No Content', async () => {
      stubFetch(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response)
      );
      const result = await client.delete<Record<string, unknown>>('/contacts/1');
      expect(result).toEqual({});
    });

    test('throws TalkdeskApiError on a 4xx response', async () => {
      stubFetch(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'not_found' })),
        } as Response)
      );
      await expect(client.get('/contacts/999')).rejects.toThrow(TalkdeskApiError);
    });

    test('retries retryable 5xx responses then surfaces the error', async () => {
      const fetchMock = stubFetch(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({ 'content-type': 'application/json', 'retry-after': '0' }),
          text: () => Promise.resolve('{"error":"unavailable"}'),
        } as Response)
      );
      try {
        await client.get('/users');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TalkdeskApiError);
        expect((err as TalkdeskApiError).statusCode).toBe(503);
      }
      // 1 initial + 3 retries
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });
});
