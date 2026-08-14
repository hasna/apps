import { describe, test, expect, afterEach } from 'bun:test';
import { StoplightClient, DEFAULT_BASE_URL } from './client';
import { StoplightApiError } from '../types';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    return Promise.resolve(handler(String(input), init ?? {}));
  }) as typeof fetch;
}

describe('StoplightClient', () => {
  test('requires a token', () => {
    expect(() => new StoplightClient({ token: '' })).toThrow('API token is required');
  });

  test('defaults to the public base URL', () => {
    expect(DEFAULT_BASE_URL).toBe('https://stoplight.io/api');
  });

  test('builds URLs with a leading slash and query params', async () => {
    let seenUrl = '';
    mockFetch((url) => {
      seenUrl = url;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new StoplightClient({ token: 'tok' });
    await client.get('/v1/projects/abc/branches', { page: 2, page_size: undefined, empty: '' });

    expect(seenUrl).toBe('https://stoplight.io/api/v1/projects/abc/branches?page=2');
  });

  test('sends the token in the Authorization header WITHOUT a Bearer prefix', async () => {
    const seen: { auth: string | null } = { auth: null };
    mockFetch((_url, init) => {
      const headers = new Headers(init.headers as HeadersInit);
      seen.auth = headers.get('Authorization');
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new StoplightClient({ token: 'my-secret-token' });
    await client.get('/v1/projects/abc');

    expect(seen.auth).toBe('my-secret-token');
    expect(seen.auth).not.toContain('Bearer');
  });

  test('honors a custom base URL and strips a trailing slash', async () => {
    let seenUrl = '';
    mockFetch((url) => {
      seenUrl = url;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const client = new StoplightClient({ token: 'tok', baseUrl: 'https://stoplight.example.com/api/' });
    await client.get('/v1/projects/abc');

    expect(seenUrl).toBe('https://stoplight.example.com/api/v1/projects/abc');
  });

  test('maps non-ok JSON responses to StoplightApiError', async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ message: 'Unauthorized', code: 401, type: 'INVALID_TOKEN' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const client = new StoplightClient({ token: 'tok' });

    let caught: unknown;
    try {
      await client.get('/v1/projects/abc/members');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(StoplightApiError);
    const apiErr = caught as StoplightApiError;
    expect(apiErr.statusCode).toBe(401);
    expect(apiErr.code).toBe(401);
    expect(apiErr.type).toBe('INVALID_TOKEN');
    expect(apiErr.message).toBe('Unauthorized');
  });

  test('handles RFC7807 problem+json error bodies', async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ title: 'Missing authorization.', status: 401 }), {
        status: 401,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );

    const client = new StoplightClient({ token: 'tok' });
    await expect(client.get('/v1/projects/abc')).rejects.toThrow('Missing authorization.');
  });

  test('returns an empty object for 204 No Content', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    const client = new StoplightClient({ token: 'tok' });
    const result = await client.delete('/v1/projects/abc');
    expect(result).toEqual({});
  });

  test('previews long tokens without exposing them', () => {
    const client = new StoplightClient({ token: 'abcdefghijklmnop' });
    expect(client.getTokenPreview()).toBe('abcdef...mnop');
  });
});
