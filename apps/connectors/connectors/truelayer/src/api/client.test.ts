import { afterEach, describe, expect, test } from 'bun:test';
import { TrueLayerClient } from './client';
import { TrueLayerApiError } from '../types';
import { PRODUCTION_BASE_URL, SANDBOX_BASE_URL } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: Recorded) => { ok: boolean; status: number; statusText?: string; headers?: Record<string, string>; body?: unknown }) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const entry: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);
    const result = handler(entry);
    const responseHeaders = new Headers(result.headers ?? { 'content-type': 'application/json' });
    return {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText ?? (result.ok ? 'OK' : 'Error'),
      headers: responseHeaders,
      async text() {
        if (result.body === undefined) return '';
        return typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TrueLayerClient', () => {
  const mockConfig = {
    accessToken: 'test-access-token-12345',
  };

  describe('constructor', () => {
    test('throws error when access token is missing', () => {
      expect(() => new TrueLayerClient({ accessToken: '' })).toThrow('TrueLayer access token is required');
    });

    test('creates client with valid config', () => {
      const client = new TrueLayerClient(mockConfig);
      expect(client).toBeInstanceOf(TrueLayerClient);
    });

    test('uses production base URL by default', () => {
      const client = new TrueLayerClient(mockConfig);
      expect(client.getBaseUrl()).toBe(PRODUCTION_BASE_URL);
    });

    test('uses sandbox base URL when sandbox is true', () => {
      const client = new TrueLayerClient({ ...mockConfig, sandbox: true });
      expect(client.getBaseUrl()).toBe(SANDBOX_BASE_URL);
      expect(client.isSandbox()).toBe(true);
    });

    test('uses custom base URL when provided', () => {
      const client = new TrueLayerClient({ ...mockConfig, baseUrl: 'https://custom.example.com/v1/' });
      expect(client.getBaseUrl()).toBe('https://custom.example.com/v1');
    });
  });

  describe('getTokenPreview', () => {
    test('returns masked token for long tokens', () => {
      const client = new TrueLayerClient(mockConfig);
      expect(client.getTokenPreview()).toBe('test-a...2345');
    });

    test('returns *** for short tokens', () => {
      const client = new TrueLayerClient({ accessToken: 'short' });
      expect(client.getTokenPreview()).toBe('***');
    });
  });

  describe('request', () => {
    test('makes GET request to /payments with Bearer header', async () => {
      const recorded = installFetch(() => ({
        ok: true,
        status: 200,
        body: { results: [] },
      }));
      const client = new TrueLayerClient(mockConfig);
      const result = await client.request('/payments');

      expect(recorded).toHaveLength(1);
      expect(recorded[0].url).toBe(`${PRODUCTION_BASE_URL}/payments`);
      expect(recorded[0].method).toBe('GET');
      expect(recorded[0].headers.authorization).toBe('Bearer test-access-token-12345');
      expect(result).toEqual({ results: [] });
    });

    test('makes GET request to /payments/:id', async () => {
      const recorded = installFetch(() => ({ ok: true, status: 200, body: { id: 'pay-1' } }));
      const client = new TrueLayerClient(mockConfig);
      await client.request('/payments/pay-1');
      expect(recorded[0].url).toBe(`${PRODUCTION_BASE_URL}/payments/pay-1`);
    });

    test('makes GET request to /events with query params', async () => {
      const recorded = installFetch(() => ({ ok: true, status: 200, body: {} }));
      const client = new TrueLayerClient(mockConfig);
      await client.request('/events', { params: { limit: 10 } });
      expect(recorded[0].url).toContain('/events');
      expect(recorded[0].url).toContain('limit=10');
    });

    test('makes POST request to /search with body', async () => {
      const recorded = installFetch(() => ({ ok: true, status: 200, body: {} }));
      const client = new TrueLayerClient(mockConfig);
      const body = { query: 'test' };
      await client.request('/search', { method: 'POST', body });

      expect(recorded[0].url).toBe(`${PRODUCTION_BASE_URL}/search`);
      expect(recorded[0].method).toBe('POST');
      expect(recorded[0].body).toBe(JSON.stringify(body));
    });

    test('passes optional Idempotency-Key and Tl-Signature headers', async () => {
      const recorded = installFetch(() => ({ ok: true, status: 201, body: {} }));
      const client = new TrueLayerClient(mockConfig);
      await client.request('/payments', {
        method: 'POST',
        body: { amount_in_minor: 100 },
        headers: {
          'Idempotency-Key': 'uuid-123',
          'Tl-Signature': 'sig-abc',
        },
      });

      expect(recorded[0].headers['idempotency-key']).toBe('uuid-123');
      expect(recorded[0].headers['tl-signature']).toBe('sig-abc');
    });

    test('throws TrueLayerApiError on error response', async () => {
      installFetch(() => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'content-type': 'application/json', 'tl-trace-id': 'trace-xyz' },
        body: { detail: 'Invalid token' },
      }));
      const client = new TrueLayerClient(mockConfig);

      try {
        await client.request('/payments');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TrueLayerApiError);
        expect((err as TrueLayerApiError).statusCode).toBe(401);
        expect((err as TrueLayerApiError).message).toBe('Invalid token');
        expect((err as TrueLayerApiError).traceId).toBe('trace-xyz');
      }
    });

    test('handles 204 No Content', async () => {
      installFetch(() => ({ ok: true, status: 204 }));
      const client = new TrueLayerClient(mockConfig);
      const result = await client.request('/payments/pay-1', { method: 'DELETE' });
      expect(result).toEqual({});
    });
  });
});
