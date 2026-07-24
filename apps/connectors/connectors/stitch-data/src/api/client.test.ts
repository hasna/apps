import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { StitchClient } from './client';
import { StitchApiError } from '../types';

/** Install a mocked global fetch and return the mock for call inspection. */
function mockFetch(impl: () => Promise<Response>) {
  const m = mock(impl);
  global.fetch = m as unknown as typeof fetch;
  return m;
}

describe('StitchClient', () => {
  const mockConfig = {
    accessToken: 'stitch-token-abcdef123456',
    clientId: 4321,
  };

  describe('constructor', () => {
    test('throws when access token is missing', () => {
      expect(() => new StitchClient({ accessToken: '' })).toThrow('A Stitch access token is required');
    });

    test('creates a client with valid config', () => {
      const client = new StitchClient(mockConfig);
      expect(client).toBeInstanceOf(StitchClient);
      expect(client.getClientId()).toBe(4321);
    });
  });

  describe('buildUrl', () => {
    test('joins base url and path', () => {
      const client = new StitchClient(mockConfig);
      expect(client.buildUrl('/v4/sources')).toBe('https://api.stitchdata.com/v4/sources');
    });

    test('adds a leading slash when the path lacks one', () => {
      const client = new StitchClient(mockConfig);
      expect(client.buildUrl('v4/sources')).toBe('https://api.stitchdata.com/v4/sources');
    });

    test('honors a custom base url without trailing slash duplication', () => {
      const client = new StitchClient({ ...mockConfig, baseUrl: 'https://eu.stitchdata.com/' });
      expect(client.buildUrl('/v4/sources')).toBe('https://eu.stitchdata.com/v4/sources');
    });

    test('appends and filters query params', () => {
      const client = new StitchClient(mockConfig);
      const url = client.buildUrl('/v4/4321/loads', { page: 2, empty: '', skip: undefined });
      expect(url).toContain('page=2');
      expect(url).not.toContain('empty=');
      expect(url).not.toContain('skip=');
    });
  });

  describe('getAccessTokenPreview', () => {
    test('masks a long token', () => {
      const client = new StitchClient(mockConfig);
      expect(client.getAccessTokenPreview()).toBe('stit...3456');
    });

    test('returns *** for a short token', () => {
      const client = new StitchClient({ accessToken: 'short' });
      expect(client.getAccessTokenPreview()).toBe('***');
    });
  });

  describe('request', () => {
    let client: StitchClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new StitchClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('sends a Bearer authorization header and parses JSON', async () => {
      const payload = [{ id: 1, type: 'platform.hubspot', display_name: 'HubSpot' }];
      const f = mockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(payload)),
        } as Response),
      );

      const result = await client.get('/v4/sources');

      expect(f).toHaveBeenCalledTimes(1);
      const [url, options] = f.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
      expect(url).toBe('https://api.stitchdata.com/v4/sources');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer stitch-token-abcdef123456');
      expect(options.headers.Accept).toBe('application/json');
      expect(result).toEqual(payload);
    });

    test('serializes a JSON body and sets Content-Type on POST', async () => {
      const f = mockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"id":9}'),
        } as Response),
      );

      const body = { type: 'platform.hubspot', display_name: 'HubSpot' };
      await client.post('/v4/sources', body);

      const [, options] = f.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('returns an empty object for 204 No Content', async () => {
      mockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          statusText: 'No Content',
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response),
      );

      const result = await client.delete('/v4/sources/1');
      expect(result).toEqual({});
    });

    test('retries on 429 then succeeds', async () => {
      let calls = 0;
      mockFetch(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Headers({ 'retry-after': '0' }),
            text: () => Promise.resolve('{"error":"rate limited"}'),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"ok":true}'),
        } as Response);
      });

      const result = await client.get('/v4/sources');
      expect(calls).toBe(2);
      expect(result).toEqual({ ok: true });
    });

    test('throws StitchApiError on a 4xx response with a message', async () => {
      mockFetch(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"type":"not_found","message":"source not found"}'),
        } as Response),
      );

      try {
        await client.get('/v4/sources/999');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StitchApiError);
        expect((err as StitchApiError).statusCode).toBe(404);
        expect((err as StitchApiError).code).toBe('not_found');
        expect((err as StitchApiError).message).toContain('source not found');
      }
    });

    test('retries on 5xx and surfaces the error when exhausted', async () => {
      let calls = 0;
      mockFetch(() => {
        calls++;
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers({ 'content-type': 'application/json', 'retry-after': '0' }),
          text: () => Promise.resolve('{"message":"boom"}'),
        } as Response);
      });

      const failing = new StitchClient({ ...mockConfig, maxRetries: 1 });
      await expect(failing.get('/v4/sources')).rejects.toThrow(StitchApiError);
      expect(calls).toBe(2); // initial attempt + 1 retry
    });
  });
});
