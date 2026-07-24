import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { StatsigClient, DEFAULT_BASE_URL, DEFAULT_API_VERSION } from './client';
import { StatsigApiError } from '../types';

type FetchMock = ReturnType<typeof mock>;

function installFetchMock(impl: (...args: unknown[]) => Promise<Response>): FetchMock {
  const fetchMock = mock(impl);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('StatsigClient', () => {
  const mockConfig = {
    apiKey: 'console-api-key-12345',
    baseUrl: DEFAULT_BASE_URL,
  };

  describe('constructor', () => {
    test('throws when API key is missing', () => {
      expect(() => new StatsigClient({})).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new StatsigClient(mockConfig);
      expect(client).toBeInstanceOf(StatsigClient);
    });

    test('accepts token alias', () => {
      const client = new StatsigClient({ token: 'token-value' });
      expect(client).toBeInstanceOf(StatsigClient);
    });
  });

  describe('getApiKeyPreview', () => {
    test('masks long API keys', () => {
      const client = new StatsigClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('consol...2345');
    });

    test('returns *** for short keys', () => {
      const client = new StatsigClient({ apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
    });
  });

  describe('request methods', () => {
    let client: StatsigClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new StatsigClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() sends Statsig auth headers and version', async () => {
      const mockResponse = { data: [] };
      const fetchMock = installFetchMock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );

      const result = await client.get('/gates');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(`${DEFAULT_BASE_URL}/gates`);
      expect(options.method).toBe('GET');
      expect(options.headers['STATSIG-API-KEY']).toBe(mockConfig.apiKey);
      expect(options.headers['STATSIG-API-VERSION']).toBe(DEFAULT_API_VERSION);
      expect(options.headers.Accept).toBe('application/json');
      expect(result).toEqual(mockResponse);
    });

    test('get() appends query parameters', async () => {
      const fetchMock = installFetchMock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response),
      );

      await client.get('/experiments', { limit: 10, page: 2 });

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('limit=10');
      expect(url).toContain('page=2');
    });

    test('post() sends JSON body with content type', async () => {
      const body = { name: 'new_gate' };
      const fetchMock = installFetchMock(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ data: body })),
        } as Response),
      );

      await client.post('/gates', body);

      const [, options] = fetchMock.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('handles 204 No Content', async () => {
      installFetchMock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response),
      );

      const result = await client.delete('/gates/test');
      expect(result).toEqual({});
    });

    test('throws StatsigApiError on 4xx response', async () => {
      installFetchMock(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Gate not found' })),
        } as Response),
      );

      await expect(client.get('/gates/missing')).rejects.toThrow(StatsigApiError);
    });

    test('parses Statsig error message field', async () => {
      installFetchMock(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Invalid gate payload' })),
        } as Response),
      );

      try {
        await client.post('/gates', {});
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StatsigApiError);
        expect((err as StatsigApiError).message).toBe('Invalid gate payload');
        expect((err as StatsigApiError).statusCode).toBe(400);
      }
    });

    test('retries on 429 then succeeds', async () => {
      let calls = 0;
      installFetchMock(() => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify({ message: 'Rate limited' })),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ data: [] })),
        } as Response);
      });

      const result = await client.get('/gates');
      expect(calls).toBe(2);
      expect(result).toEqual({ data: [] });
    });
  });
});
