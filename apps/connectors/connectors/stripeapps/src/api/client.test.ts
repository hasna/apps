import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { StripeApps } from './index';
import { StripeAppsClient, DEFAULT_BASE_URL } from './client';
import { StripeAppsApiError } from '../types';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function stubFetch(makeResponse: () => Response, captured: CapturedRequest[]): typeof global.fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers as Record<string, string> | undefined;
    if (rawHeaders) {
      for (const [k, v] of Object.entries(rawHeaders)) headers[k] = v;
    }
    captured.push({
      url: String(input),
      method: init?.method || 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return makeResponse();
  }) as typeof global.fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('StripeAppsClient', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('requires an API key', () => {
    expect(() => new StripeAppsClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('defaults to the public base URL and sends a Bearer token', async () => {
    const captured: CapturedRequest[] = [];
    global.fetch = stubFetch(() => jsonResponse({ data: [] }), captured);

    const client = new StripeAppsClient({ apiKey: 'sk_test_123' });
    await client.get('/items');

    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe(`${DEFAULT_BASE_URL}/items`);
    expect(captured[0]!.headers.Authorization).toBe('Bearer sk_test_123');
    expect(captured[0]!.headers.Accept).toBe('application/json');
  });

  test('honors a custom base URL and trims trailing slashes', async () => {
    const captured: CapturedRequest[] = [];
    global.fetch = stubFetch(() => jsonResponse({ ok: true }), captured);

    const client = new StripeAppsClient({ apiKey: 'k', baseUrl: 'https://example.test/v2/' });
    await client.get('/events');

    expect(captured[0]!.url).toBe('https://example.test/v2/events');
  });

  test('appends defined query params only', async () => {
    const captured: CapturedRequest[] = [];
    global.fetch = stubFetch(() => jsonResponse({ data: [] }), captured);

    const client = new StripeAppsClient({ apiKey: 'k' });
    await client.get('/items', { limit: 5, cursor: undefined, status: '' });

    const url = new URL(captured[0]!.url);
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.has('cursor')).toBe(false);
    expect(url.searchParams.has('status')).toBe(false);
  });

  test('serializes JSON bodies with a content-type header', async () => {
    const captured: CapturedRequest[] = [];
    global.fetch = stubFetch(() => jsonResponse({ id: 'item_1' }), captured);

    const client = new StripeAppsClient({ apiKey: 'k' });
    await client.post('/items', { name: 'Widget' });

    expect(captured[0]!.method).toBe('POST');
    expect(captured[0]!.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(captured[0]!.body!)).toEqual({ name: 'Widget' });
  });

  test('throws a typed error with parsed detail on non-2xx', async () => {
    global.fetch = stubFetch(
      () => jsonResponse({ error: { code: 'not_found', message: 'No such item', param: 'id' } }, 404),
      [],
    );

    const client = new StripeAppsClient({ apiKey: 'k' });
    let caught: unknown;
    try {
      await client.get('/items/nope');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StripeAppsApiError);
    const e = caught as StripeAppsApiError;
    expect(e.statusCode).toBe(404);
    expect(e.message).toBe('No such item');
    expect(e.detail?.code).toBe('not_found');
  });

  test('masks the API key preview', () => {
    const client = new StripeAppsClient({ apiKey: 'sk_test_abcdef1234' });
    expect(client.getApiKeyPreview()).toBe('sk_tes...1234');
  });
});

describe('StripeApps modules', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('items.get encodes the path and uses GET', async () => {
    const captured: CapturedRequest[] = [];
    global.fetch = stubFetch(() => jsonResponse({ id: 'a b' }), captured);

    const client = new StripeApps({ apiKey: 'k' });
    await client.items.get('a b');

    expect(captured[0]!.method).toBe('GET');
    expect(captured[0]!.url).toBe(`${DEFAULT_BASE_URL}/items/a%20b`);
  });

  test('search posts the query to /search', async () => {
    const captured: CapturedRequest[] = [];
    global.fetch = stubFetch(() => jsonResponse({ data: [] }), captured);

    const client = new StripeApps({ apiKey: 'k' });
    await client.search.search({ query: 'widget', limit: 3, filters: { category: 'hw' } });

    expect(captured[0]!.url).toBe(`${DEFAULT_BASE_URL}/search`);
    expect(JSON.parse(captured[0]!.body!)).toEqual({
      query: 'widget',
      limit: 3,
      filters: { category: 'hw' },
    });
  });

  test('search rejects an empty query', () => {
    const client = new StripeApps({ apiKey: 'k' });
    expect(() => client.search.search({ query: '' })).toThrow('query is required');
  });

  test('fromEnv requires STRIPEAPPS_API_KEY', () => {
    const prev = process.env.STRIPEAPPS_API_KEY;
    delete process.env.STRIPEAPPS_API_KEY;
    try {
      expect(() => StripeApps.fromEnv()).toThrow('STRIPEAPPS_API_KEY');
    } finally {
      if (prev !== undefined) process.env.STRIPEAPPS_API_KEY = prev;
    }
  });
});
