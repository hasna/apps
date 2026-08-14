import { afterEach, describe, expect, test } from 'bun:test';
import { SupabaseApiPlatformClient } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    recorded.push({ url, method: init?.method ?? 'GET', headers });
    const json = handler(url, init, recorded);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

function authHeader(recorded: Recorded[]): string | undefined {
  const headers = recorded[0]?.headers ?? {};
  return headers.Authorization ?? headers.authorization;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('SupabaseApiPlatformClient', () => {
  test('listItems calls GET /v1/projects with Bearer auth', async () => {
    const recorded = installFetch(() => ({}));
    const credential = 'sample-credential';
    const client = new SupabaseApiPlatformClient({ accessToken: credential });
    await client.listItems();
    expect(recorded[0].url).toBe('https://api.supabase.com/v1/projects');
    expect(recorded[0].method).toBe('GET');
    expect(authHeader(recorded)).toBe(['Bearer', credential].join(' '));
  });

  test('getItem calls GET /v1/projects/:ref', async () => {
    const recorded = installFetch(() => ({}));
    const credential = 'sample-credential';
    const client = new SupabaseApiPlatformClient({ accessToken: credential });
    await client.getItem('abcdefghijklmnop');
    expect(recorded[0].url).toBe('https://api.supabase.com/v1/projects/abcdefghijklmnop');
    expect(authHeader(recorded)).toBe(['Bearer', credential].join(' '));
  });

  test('createItem posts to /v1/projects', async () => {
    const recorded = installFetch(() => ({}));
    const client = new SupabaseApiPlatformClient({ accessToken: 'test-token' });
    await client.createItem({ name: 'my-project', organization_id: 'org-1' });
    expect(recorded[0].url).toBe('https://api.supabase.com/v1/projects');
    expect(recorded[0].method).toBe('POST');
  });

  test('does not expose unsupported audit or search helpers', () => {
    const client = new SupabaseApiPlatformClient({ accessToken: 'test-token' });
    expect('listEvents' in client).toBe(false);
    expect('search' in client).toBe(false);
  });

  test('rawRequest preserves raw Management API access', async () => {
    const recorded = installFetch(() => ({}));
    const client = new SupabaseApiPlatformClient({ accessToken: 'test-token' });
    await client.rawRequest('/organizations', { params: { limit: 1 } });
    expect(recorded[0].url).toBe('https://api.supabase.com/v1/organizations?limit=1');
    expect(recorded[0].method).toBe('GET');
  });

  test('respects custom base URL', async () => {
    const recorded = installFetch(() => ({}));
    const client = new SupabaseApiPlatformClient({
      accessToken: 'test-token',
      baseUrl: 'https://custom.example.com/v1',
    });
    await client.listItems();
    expect(recorded[0].url).toBe('https://custom.example.com/v1/projects');
  });

  test('requires access token', () => {
    expect(() => new SupabaseApiPlatformClient({ accessToken: '' })).toThrow('Access token is required');
  });
});
