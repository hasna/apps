import { afterEach, describe, expect, test } from 'bun:test';
import { Connector, ConnectorClient, DEFAULT_BASE_URL } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: RecordedRequest) => unknown) {
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
    const json = handler(entry);
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

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Velum Data Quality API client', () => {
  test('requires an API key', () => {
    expect(() => new ConnectorClient({})).toThrow('API key');
  });

  test('uses default base URL', () => {
    const client = new ConnectorClient({ apiKey: 'test-key' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  test('listChecks sends Bearer auth to GET /checks', async () => {
    const recorded = installFetch((req) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe(`${DEFAULT_BASE_URL}/checks`);
      expect(req.headers.authorization).toBe('Bearer velum-test-key');
      return { checks: [{ id: 'chk_1' }] };
    });

    const connector = new Connector({ apiKey: 'velum-test-key' });
    const result = await connector.checks.list();
    expect(result).toEqual({ checks: [{ id: 'chk_1' }] });
    expect(recorded).toHaveLength(1);
  });

  test('getCheck encodes check ID in path', async () => {
    const recorded = installFetch((req) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe(`${DEFAULT_BASE_URL}/checks/check%2F123`);
      return { id: 'check/123', status: 'active' };
    });

    const connector = new Connector({ apiKey: 'velum-test-key' });
    const result = await connector.checks.get('check/123');
    expect(result).toEqual({ id: 'check/123', status: 'active' });
    expect(recorded).toHaveLength(1);
  });

  test('createCheck POSTs JSON body to /checks', async () => {
    const recorded = installFetch((req) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe(`${DEFAULT_BASE_URL}/checks`);
      expect(req.body).toBe(JSON.stringify({ name: 'freshness' }));
      return { id: 'chk_new', name: 'freshness' };
    });

    const connector = new Connector({ apiKey: 'velum-test-key' });
    const result = await connector.checks.create({ name: 'freshness' });
    expect(result).toEqual({ id: 'chk_new', name: 'freshness' });
    expect(recorded).toHaveLength(1);
  });

  test('listEvents hits GET /events', async () => {
    const recorded = installFetch((req) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe(`${DEFAULT_BASE_URL}/events`);
      return { events: [{ id: 'evt_1' }] };
    });

    const connector = new Connector({ apiKey: 'velum-test-key' });
    const result = await connector.events.list();
    expect(result).toEqual({ events: [{ id: 'evt_1' }] });
    expect(recorded).toHaveLength(1);
  });

  test('search POSTs to /search', async () => {
    const recorded = installFetch((req) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe(`${DEFAULT_BASE_URL}/search`);
      expect(req.body).toBe(JSON.stringify({ query: 'failed' }));
      return { results: [] };
    });

    const connector = new Connector({ apiKey: 'velum-test-key' });
    const result = await connector.search.search({ query: 'failed' });
    expect(result).toEqual({ results: [] });
    expect(recorded).toHaveLength(1);
  });

  test('rawRequest supports custom path and method', async () => {
    const recorded = installFetch((req) => {
      expect(req.method).toBe('PATCH');
      expect(req.url).toBe(`${DEFAULT_BASE_URL}/checks/chk_1`);
      return { ok: true };
    });

    const connector = new Connector({ apiKey: 'velum-test-key' });
    await connector.rawRequest({ method: 'PATCH', path: '/checks/chk_1', body: { status: 'paused' } });
    expect(recorded).toHaveLength(1);
  });

  test('respects custom base URL from config', async () => {
    const recorded = installFetch((req) => {
      expect(req.url).toBe('https://custom.example.com/v2/checks');
      return { checks: [] };
    });

    const connector = new Connector({
      apiKey: 'velum-test-key',
      baseUrl: 'https://custom.example.com/v2',
    });
    await connector.checks.list();
    expect(recorded).toHaveLength(1);
  });
});
