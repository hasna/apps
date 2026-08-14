import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { UserflowClient } from './client';
import { USERFLOW_API_VERSION, UserflowApiError } from '../types';

type CapturedCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

describe('UserflowClient', () => {
  const mockConfig = {
    apiKey: 'uf-key',
    baseUrl: 'https://api.userflow.com',
  };

  let originalFetch: typeof global.fetch;
  let captured: CapturedCall[];

  beforeEach(() => {
    originalFetch = global.fetch;
    captured = [];
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      captured.push({
        url,
        method: init?.method ?? 'GET',
        headers,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('constructor', () => {
    test('throws when API key is missing', () => {
      expect(() => new UserflowClient({ apiKey: '' })).toThrow('Userflow API key is required');
    });

    test('creates client with valid config', () => {
      expect(new UserflowClient(mockConfig)).toBeInstanceOf(UserflowClient);
    });

    test('accepts token alias', () => {
      expect(new UserflowClient({ token: 'uf-key' })).toBeInstanceOf(UserflowClient);
    });
  });

  describe('request', () => {
    test('sends Bearer auth and Userflow-Version header', async () => {
      const client = new UserflowClient(mockConfig);
      await client.get('/v2/users');

      const req = captured[0]!;
      expect(req.headers.authorization).toBe('Bearer uf-key');
      expect(req.headers['userflow-version']).toBe(USERFLOW_API_VERSION);
      expect(req.headers.accept).toBe('application/json');
    });

    test('appends query parameters', async () => {
      const client = new UserflowClient(mockConfig);
      await client.get('/v2/users', { limit: 25, starting_after: 'cursor-a', q: 'ada' });

      const url = new URL(captured[0]!.url);
      expect(url.searchParams.get('limit')).toBe('25');
      expect(url.searchParams.get('starting_after')).toBe('cursor-a');
      expect(url.searchParams.get('q')).toBe('ada');
    });

    test('POST sends JSON body and Content-Type', async () => {
      const client = new UserflowClient(mockConfig);
      const body = { id: 'u-1', attributes: { plan: 'pro' } };
      await client.post('/v2/users', body);

      const req = captured[0]!;
      expect(req.method).toBe('POST');
      expect(req.headers['content-type']).toBe('application/json');
      expect(JSON.parse(req.body!)).toEqual(body);
    });

    test('parses API error message', async () => {
      global.fetch = (async () => jsonResponse({ message: 'forbidden' }, 403)) as unknown as typeof fetch;
      const client = new UserflowClient(mockConfig);
      await expect(client.get('/v2/users')).rejects.toThrow('Userflow: forbidden');
    });

    test('throws UserflowApiError with status code', async () => {
      global.fetch = (async () => jsonResponse({ message: 'forbidden' }, 403)) as unknown as typeof fetch;
      const client = new UserflowClient(mockConfig);
      try {
        await client.get('/v2/users');
        expect.unreachable('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(UserflowApiError);
        expect((err as UserflowApiError).statusCode).toBe(403);
      }
    });

    test('handles 204 No Content', async () => {
      global.fetch = (async () =>
        ({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        }) as Response) as unknown as typeof fetch;

      const client = new UserflowClient(mockConfig);
      const result = await client.delete('/v2/users/u-1');
      expect(result).toEqual({});
    });
  });

  describe('getApiKeyPreview', () => {
    test('masks long keys', () => {
      const client = new UserflowClient({ apiKey: 'abcdefghijklmnop' });
      expect(client.getApiKeyPreview()).toBe('abcdef...mnop');
    });
  });
});
