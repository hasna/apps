import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { VantaClient } from './client';
import { EventsApi } from './events';

describe('VantaClient', () => {
  const config = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    scope: 'vanta-api.all:read',
    baseUrl: 'https://api.vanta.com/v1',
  };

  let originalFetch: typeof global.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  beforeEach(() => {
    calls.length = 0;
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(handlers: Record<string, unknown | ((init?: RequestInit) => unknown)>) {
    global.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init });

      if (url.includes('/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'test-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      for (const [pattern, handler] of Object.entries(handlers)) {
        if (url.includes(pattern)) {
          const body = typeof handler === 'function' ? handler(init) : handler;
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
      }

      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
  }

  test('exchanges client credentials via JSON POST /oauth/token', async () => {
    mockFetch({ '/controls': { results: { data: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } } } });

    const client = new VantaClient(config);
    await client.get('/controls');

    const tokenCall = calls.find(c => c.url.includes('/oauth/token'));
    expect(tokenCall).toBeDefined();
    expect(tokenCall!.init?.method).toBe('POST');
    expect(tokenCall!.init?.headers).toMatchObject({ 'Content-Type': 'application/json' });

    const body = JSON.parse(tokenCall!.init?.body as string);
    expect(body).toEqual({
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
      scope: 'vanta-api.all:read',
      grant_type: 'client_credentials',
    });
  });

  test('sends Bearer token on GET /controls', async () => {
    mockFetch({ '/controls': { results: { data: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } } } });

    const client = new VantaClient(config);
    await client.get('/controls');

    const controlsCall = calls.find(c => c.url.includes('/controls') && !c.url.includes('/oauth/token'));
    expect(controlsCall).toBeDefined();
    expect(new Headers(controlsCall!.init?.headers).get('Authorization')).toBe('Bearer test-access-token');
  });

  test('reuses cached token before expiry', async () => {
    mockFetch({
      '/controls': { ok: true },
      '/documents': { ok: true },
    });

    const client = new VantaClient(config);
    await client.get('/controls');
    await client.get('/documents');

    const tokenCalls = calls.filter(c => c.url.includes('/oauth/token'));
    expect(tokenCalls.length).toBe(1);
  });

  test('EventsApi.list hits /event-logs', async () => {
    mockFetch({
      '/event-logs': {
        results: {
          data: [{ id: 'evt-1', date: '2026-01-01T00:00:00Z', action: 'created', initiator: { type: 'user', id: 'u1' } }],
          pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
        },
      },
    });

    const client = new VantaClient(config);
    const events = new EventsApi(client);
    const result = await events.list({ startDate: '2026-01-01T00:00:00Z' });

    const eventsCall = calls.find(c => c.url.includes('/event-logs'));
    expect(eventsCall).toBeDefined();
    expect(eventsCall!.url).toContain('startDate=2026-01-01T00%3A00%3A00Z');
    expect(result.results.data).toHaveLength(1);
  });

  test('throws when clientId or clientSecret missing', () => {
    expect(() => new VantaClient({ clientId: '', clientSecret: 'x' })).toThrow('clientId and clientSecret are required');
  });
});
