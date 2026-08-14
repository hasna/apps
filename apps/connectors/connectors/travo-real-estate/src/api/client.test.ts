import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient } from './client';
import { TravoRealEstate } from './index';
import { ConnectorApiError } from '../types';

describe('ConnectorClient', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('requires apiKey', () => {
    expect(() => new ConnectorClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('creates client with valid config', () => {
    const client = new ConnectorClient({ apiKey: 'travo-real-estate-key' });
    expect(client.getApiKeyPreview()).toBe('travo-...-key');
  });

  test('uses custom base URL', () => {
    const client = new ConnectorClient({
      apiKey: 'key',
      baseUrl: 'https://custom.example/v2',
    });
    expect(client.getBaseUrl()).toBe('https://custom.example/v2');
    expect(client.buildRequestUrl('/listings')).toBe('https://custom.example/v2/listings');
  });

  test('builds default listings URL', () => {
    const client = new ConnectorClient({ apiKey: 'key' });
    expect(client.buildRequestUrl('/listings')).toBe('https://api.travo-real-estate.com/v1/listings');
  });

  test('sends Bearer authorization header', async () => {
    const client = new ConnectorClient({ apiKey: 'travo-real-estate-key' });
    const captured: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === 'string' ? input : input.toString(),
        init,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as any;

    await client.get('/listings');
    expect(captured[0]?.url).toBe('https://api.travo-real-estate.com/v1/listings');
    expect(new Headers(captured[0]?.init?.headers).get('Authorization')).toBe('Bearer travo-real-estate-key');
  });

  test('GET listing by ID uses encoded path', async () => {
    const client = new ConnectorClient({ apiKey: 'travo-real-estate-key' });
    const captured: string[] = [];

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      captured.push(typeof input === 'string' ? input : input.toString());
      return new Response(JSON.stringify({ id: 'item-1' }), { status: 200 });
    }) as any;

    await client.get('/listings/item-1');
    expect(captured[0]).toBe('https://api.travo-real-estate.com/v1/listings/item-1');
  });

  test('GET events endpoint', async () => {
    const client = new ConnectorClient({ apiKey: 'travo-real-estate-key' });
    const captured: string[] = [];

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      captured.push(typeof input === 'string' ? input : input.toString());
      return new Response(JSON.stringify({ events: [] }), { status: 200 });
    }) as any;

    await client.get('/events', { limit: 10 });
    expect(captured[0]).toBe('https://api.travo-real-estate.com/v1/events?limit=10');
  });

  test('POST search endpoint', async () => {
    const client = new ConnectorClient({ apiKey: 'travo-real-estate-key' });
    const captured: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === 'string' ? input : input.toString(),
        init,
      });
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as any;

    await client.post('/search', { query: 'apartment' });
    expect(captured[0]?.url).toBe('https://api.travo-real-estate.com/v1/search');
    expect(captured[0]?.init?.method).toBe('POST');
    expect(captured[0]?.init?.body).toBe(JSON.stringify({ query: 'apartment' }));
  });

  test('throws ConnectorApiError on HTTP error', async () => {
    const client = new ConnectorClient({ apiKey: 'travo-real-estate-key' });

    globalThis.fetch = mock(async () =>
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
    ) as any;

    await expect(client.get('/listings')).rejects.toThrow();
  });
});

describe('TravoRealEstate', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('fromEnv requires TRAVO_REAL_ESTATE_API_KEY', () => {
    const original = process.env.TRAVO_REAL_ESTATE_API_KEY;
    delete process.env.TRAVO_REAL_ESTATE_API_KEY;
    expect(() => TravoRealEstate.fromEnv()).toThrow('TRAVO_REAL_ESTATE_API_KEY');
    if (original) process.env.TRAVO_REAL_ESTATE_API_KEY = original;
  });

  test('listListings and getListing hit expected paths', async () => {
    const connector = new TravoRealEstate({ apiKey: 'travo-real-estate-key' });
    const captured: string[] = [];

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      captured.push(typeof input === 'string' ? input : input.toString());
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as any;

    await connector.listListings();
    await connector.getListing('item-1');

    expect(captured[0]).toBe('https://api.travo-real-estate.com/v1/listings');
    expect(captured[1]).toBe('https://api.travo-real-estate.com/v1/listings/item-1');
  });
});

describe('ConnectorApiError', () => {
  test('captures status code and response body', () => {
    const err = new ConnectorApiError('unauthorized', 401, '{"error":"invalid_key"}');
    expect(err.statusCode).toBe(401);
    expect(err.responseBody).toBe('{"error":"invalid_key"}');
    expect(err.name).toBe('ConnectorApiError');
  });
});
