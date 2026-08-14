import { afterEach, describe, expect, test } from 'bun:test';
import { VitallyClient, buildBasicAuthHeader, resolveBaseUrl } from './client';
import { VitallyApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => {
    ok: boolean;
    status: number;
    json?: unknown;
    text?: string;
  }
): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const result = handler(url, init, recorded);
    const payload = result.json !== undefined ? JSON.stringify(result.json) : (result.text ?? '');
    return {
      ok: result.ok,
      status: result.status,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => payload,
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('buildBasicAuthHeader', () => {
  test('encodes API secret as Basic auth username with empty password', () => {
    const header = buildBasicAuthHeader('secret_key_123');
    expect(header).toBe(`Basic ${Buffer.from('secret_key_123:', 'utf-8').toString('base64')}`);
  });
});

describe('resolveBaseUrl', () => {
  test('builds US subdomain URL', () => {
    expect(resolveBaseUrl({ subdomain: 'acme', region: 'us' })).toBe('https://acme.rest.vitally.io');
  });

  test('uses EU base URL without subdomain', () => {
    expect(resolveBaseUrl({ region: 'eu' })).toBe('https://rest.vitally-eu.io');
  });

  test('honors explicit base URL override', () => {
    expect(resolveBaseUrl({ baseUrl: 'https://custom.example.io/' })).toBe('https://custom.example.io');
  });

  test('throws when US region lacks subdomain', () => {
    expect(() => resolveBaseUrl({ region: 'us' })).toThrow('Subdomain is required');
  });
});

describe('VitallyClient', () => {
  const mockConfig = {
    apiKey: 'test-api-secret',
    subdomain: 'acme',
    region: 'us' as const,
  };

  describe('constructor', () => {
    test('throws when API key is missing', () => {
      expect(() => new VitallyClient({ apiKey: '', subdomain: 'acme' })).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new VitallyClient(mockConfig);
      expect(client.getBaseUrl()).toBe('https://acme.rest.vitally.io');
    });
  });

  describe('request methods', () => {
    test('get() uses Basic Authorization and /resources/accounts path', async () => {
      const recorded = installFetch(() => ({
        ok: true,
        status: 200,
        json: { results: [] },
      }));

      const client = new VitallyClient(mockConfig);
      const result = await client.get('/resources/accounts', { limit: 10 });

      expect(recorded).toHaveLength(1);
      expect(recorded[0].url).toBe('https://acme.rest.vitally.io/resources/accounts?limit=10');
      expect(recorded[0].method).toBe('GET');
      expect(recorded[0].headers.authorization).toBe(buildBasicAuthHeader('test-api-secret'));
      expect(result).toEqual({ results: [] });
    });

    test('getAccount path encodes account ID', async () => {
      const recorded = installFetch(() => ({
        ok: true,
        status: 200,
        json: { id: 'acct-1' },
      }));

      const client = new VitallyClient(mockConfig);
      await client.get('/resources/accounts/acct%2F1');

      expect(recorded[0].url).toBe('https://acme.rest.vitally.io/resources/accounts/acct%2F1');
    });

    test('post() sends search request to /resources/search', async () => {
      const recorded = installFetch(() => ({
        ok: true,
        status: 200,
        json: { results: [{ id: '1' }] },
      }));

      const client = new VitallyClient(mockConfig);
      const body = { query: 'enterprise', limit: 5 };
      const result = await client.post('/resources/search', body);

      expect(recorded[0].url).toBe('https://acme.rest.vitally.io/resources/search');
      expect(recorded[0].method).toBe('POST');
      expect(recorded[0].headers['content-type']).toBe('application/json');
      expect(recorded[0].body).toBe(JSON.stringify(body));
      expect(result).toEqual({ results: [{ id: '1' }] });
    });

    test('uses pre-encoded auth header when provided', async () => {
      const recorded = installFetch(() => ({ ok: true, status: 200, json: {} }));

      const client = new VitallyClient({
        apiKey: 'ignored',
        subdomain: 'acme',
        authHeader: 'Basic copied-from-ui',
      });
      await client.get('/resources/accounts');

      expect(recorded[0].headers.authorization).toBe('Basic copied-from-ui');
    });

    test('throws VitallyApiError on error responses', async () => {
      installFetch(() => ({
        ok: false,
        status: 401,
        json: { message: 'Unauthorized' },
      }));

      const client = new VitallyClient(mockConfig);
      await expect(client.get('/resources/accounts')).rejects.toThrow(VitallyApiError);
    });
  });
});
