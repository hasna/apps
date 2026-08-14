import { afterEach, describe, expect, test } from 'bun:test';
import { ConnectorClient, DEFAULT_BASE_URL } from './client';
import { TheTradeDesk } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers[lower] ?? headers[name];
}

function installFetch(handler?: (recorded: RecordedRequest) => unknown) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const entry: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);
    const payload = handler ? handler(entry) : { ok: true };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(payload ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('The Trade Desk ConnectorClient', () => {
  test('sends Bearer authorization header', async () => {
    const recorded = installFetch();
    const client = new ConnectorClient({ apiKey: 'test-api-key' });
    await client.get('/campaigns');
    expect(headerValue(recorded[0]?.headers ?? {}, 'Authorization')).toBe('Bearer test-api-key');
  });

  test('lists campaigns at default base URL', async () => {
    const recorded = installFetch();
    const client = new ConnectorClient({ apiKey: 'test-api-key' });
    await client.get('/campaigns');
    expect(recorded[0]?.url).toBe(`${DEFAULT_BASE_URL}/campaigns`);
    expect(recorded[0]?.method).toBe('GET');
  });

  test('gets a campaign by ID with encoded path', async () => {
    const recorded = installFetch();
    const client = new ConnectorClient({ apiKey: 'test-api-key' });
    await client.get('/campaigns/item-1');
    expect(recorded[0]?.url).toBe(`${DEFAULT_BASE_URL}/campaigns/item-1`);
  });

  test('creates a campaign via POST', async () => {
    const recorded = installFetch();
    const client = new ConnectorClient({ apiKey: 'test-api-key' });
    await client.post('/campaigns', { name: 'Launch' });
    expect(recorded[0]?.method).toBe('POST');
    expect(recorded[0]?.url).toBe(`${DEFAULT_BASE_URL}/campaigns`);
    expect(JSON.parse(recorded[0]?.body ?? '{}')).toEqual({ name: 'Launch' });
  });

  test('searches via POST /search', async () => {
    const recorded = installFetch();
    const client = new ConnectorClient({ apiKey: 'test-api-key' });
    await client.post('/search', { query: 'advertiser' });
    expect(recorded[0]?.url).toBe(`${DEFAULT_BASE_URL}/search`);
    expect(JSON.parse(recorded[0]?.body ?? '{}')).toEqual({ query: 'advertiser' });
  });

  test('supports optional base_url override', async () => {
    const recorded = installFetch();
    const client = new ConnectorClient({
      apiKey: 'test-api-key',
      baseUrl: 'https://sandbox.example.com/v1/',
    });
    await client.get('/events', { page: 1 });
    expect(recorded[0]?.url).toBe('https://sandbox.example.com/v1/events?page=1');
  });

  test('requires API key', () => {
    expect(() => new ConnectorClient({})).toThrow('API key is required');
  });
});

describe('TheTradeDesk facade', () => {
  test('campaigns.list uses bearer auth', async () => {
    const recorded = installFetch();
    const ttd = new TheTradeDesk({ apiKey: 'the-trade-desk-key' });
    await ttd.campaigns.list();
    await ttd.campaigns.get('item-1');
    expect(recorded[0]?.url).toBe(`${DEFAULT_BASE_URL}/campaigns`);
    expect(recorded[1]?.url).toBe(`${DEFAULT_BASE_URL}/campaigns/item-1`);
    for (const req of recorded) {
      expect(headerValue(req.headers, 'Authorization')).toBe('Bearer the-trade-desk-key');
    }
  });

  test('rawRequest forwards method and path', async () => {
    const recorded = installFetch();
    const ttd = new TheTradeDesk({ apiKey: 'key' });
    await ttd.rawRequest({ method: 'PUT', path: '/campaigns/c1', body: { name: 'Updated' } });
    expect(recorded[0]?.method).toBe('PUT');
    expect(recorded[0]?.url).toBe(`${DEFAULT_BASE_URL}/campaigns/c1`);
  });
});
