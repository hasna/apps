import { afterEach, describe, expect, test } from 'bun:test';
import { ZohoClient, DEFAULT_BASE_URL } from './client';
import { ZohoApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: Recorded) => { status?: number; ok?: boolean; body?: unknown; statusText?: string }) {
  const calls: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const recorded: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: init?.body as string | undefined,
    };
    calls.push(recorded);
    const response = handler(recorded);
    const body = response.body ?? {};
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      statusText: response.statusText ?? 'OK',
      async text() {
        return typeof body === 'string' ? body : JSON.stringify(body);
      },
    } as Response;
  }) as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('ZohoClient', () => {
  const mockConfig = {
    accessToken: 'test-oauth-token-12345',
    baseUrl: 'https://www.zohoapis.com/crm/v8',
  };

  describe('constructor', () => {
    test('throws error when access token is missing', () => {
      expect(() => new ZohoClient({ accessToken: '' })).toThrow('Zoho access token is required');
    });

    test('creates client with valid config', () => {
      const client = new ZohoClient(mockConfig);
      expect(client).toBeInstanceOf(ZohoClient);
    });

    test('uses default v8 base URL when not provided', () => {
      const client = new ZohoClient({ accessToken: 'token' });
      expect(client).toBeInstanceOf(ZohoClient);
    });
  });

  describe('getAccessTokenPreview', () => {
    test('returns masked token for long tokens', () => {
      const client = new ZohoClient(mockConfig);
      expect(client.getAccessTokenPreview()).toBe('test-o...2345');
    });

    test('returns *** for short tokens', () => {
      const client = new ZohoClient({ accessToken: 'short' });
      expect(client.getAccessTokenPreview()).toBe('***');
    });
  });

  describe('request', () => {
    test('makes GET request with Zoho-oauthtoken header', async () => {
      const calls = installFetch(() => ({
        body: { data: [{ id: '1', Last_Name: 'Smith' }] },
      }));
      const client = new ZohoClient(mockConfig);
      const result = await client.request('/Contacts');

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`${DEFAULT_BASE_URL}/Contacts`);
      expect(calls[0].method).toBe('GET');
      expect(calls[0].headers.authorization).toBe('Zoho-oauthtoken test-oauth-token-12345');
      expect(result).toEqual({ data: [{ id: '1', Last_Name: 'Smith' }] });
    });

    test('appends query parameters', async () => {
      const calls = installFetch(() => ({ body: { data: [] } }));
      const client = new ZohoClient(mockConfig);
      await client.request('/Contacts', { params: { page: 2, per_page: 50 } });

      expect(calls[0].url).toContain('page=2');
      expect(calls[0].url).toContain('per_page=50');
    });

    test('makes POST request with JSON body', async () => {
      const calls = installFetch(() => ({ status: 201, body: { data: [{ status: 'success' }] } }));
      const client = new ZohoClient(mockConfig);
      const body = { data: [{ Last_Name: 'Doe', First_Name: 'Jane' }] };
      await client.request('/Contacts', { method: 'POST', body });

      expect(calls[0].method).toBe('POST');
      expect(calls[0].headers['content-type']).toBe('application/json');
      expect(calls[0].body).toBe(JSON.stringify(body));
    });

    test('handles 204 No Content response', async () => {
      installFetch(() => ({ status: 204, body: '' }));
      const client = new ZohoClient(mockConfig);
      const result = await client.request('/Contacts/1', { method: 'DELETE' });
      expect(result).toEqual({});
    });

    test('throws ZohoApiError on error response', async () => {
      installFetch(() => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        body: { message: 'Invalid token', code: 'INVALID_TOKEN' },
      }));
      const client = new ZohoClient(mockConfig);
      await expect(client.request('/Contacts')).rejects.toThrow(ZohoApiError);
    });
  });
});
