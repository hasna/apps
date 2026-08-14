import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TursoClient } from './client';
import { TursoApiError } from '../types';

describe('TursoClient', () => {
  const mockConfig = {
    apiKey: 'test-api-token-12345',
    organization: 'my-org',
  };

  describe('constructor', () => {
    test('throws error when apiKey is missing', () => {
      expect(() => new TursoClient({ apiKey: '', organization: 'my-org' })).toThrow('API token is required');
    });

    test('throws error when organization is missing', () => {
      expect(() => new TursoClient({ apiKey: 'token', organization: '' })).toThrow('Organization slug is required');
    });

    test('creates client with valid config', () => {
      const client = new TursoClient(mockConfig);
      expect(client).toBeInstanceOf(TursoClient);
    });
  });

  describe('orgPath', () => {
    test('encodes organization slug in path', () => {
      const client = new TursoClient({ apiKey: 'token', organization: 'org/with space' });
      expect(client.orgPath('/databases')).toBe('/organizations/org%2Fwith%20space/databases');
    });
  });

  describe('getApiKeyPreview', () => {
    test('returns masked token for long tokens', () => {
      const client = new TursoClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('test-a...2345');
    });

    test('returns *** for short tokens', () => {
      const client = new TursoClient({ ...mockConfig, apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
    });
  });

  describe('request methods', () => {
    let client: TursoClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new TursoClient(mockConfig, 'https://api.turso.tech/v1');
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() sends Bearer authorization header', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"databases":[]}'),
        } as Response),
      );

      await client.get(client.orgPath('/databases'));

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.turso.tech/v1/organizations/my-org/databases');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer test-api-token-12345');
      expect(options.headers.Accept).toBe('application/json');
    });

    test('get() appends query parameters', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response),
      );

      await client.get(client.orgPath('/databases'), { group: 'default', parent: undefined });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('group=default');
      expect(url).not.toContain('parent');
    });

    test('post() sends JSON body', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"database":{"Name":"new-db"}}'),
        } as Response),
      );

      const body = { name: 'new-db', group: 'default' };
      await client.post(client.orgPath('/databases'), body);

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('throws TursoApiError on 4xx response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'database not found' })),
        } as Response),
      );

      await expect(client.get(client.orgPath('/databases/missing'))).rejects.toThrow(TursoApiError);
    });

    test('parses error field from JSON response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 409,
          statusText: 'Conflict',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'database with name [db] already exists' })),
        } as Response),
      );

      try {
        await client.post(client.orgPath('/databases'), { name: 'db', group: 'default' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TursoApiError);
        expect((err as TursoApiError).message).toBe('database with name [db] already exists');
        expect((err as TursoApiError).statusCode).toBe(409);
      }
    });

    test('retries on 429 then succeeds', async () => {
      let calls = 0;
      global.fetch = mock(() => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Headers({ 'content-type': 'application/json', 'retry-after': '0' }),
            text: () => Promise.resolve(JSON.stringify({ error: 'rate limited' })),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"databases":[]}'),
        } as Response);
      });

      const result = await client.get<{ databases: unknown[] }>(client.orgPath('/databases'));
      expect(result.databases).toEqual([]);
      expect(calls).toBe(2);
    });

    test('handles 204 No Content response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response),
      );

      const result = await client.delete(client.orgPath('/databases/my-db'));
      expect(result).toEqual({});
    });
  });
});
