import { afterEach, describe, expect, test } from 'bun:test';
import { Connector } from './index';
import { ConnectorClient, DEFAULT_BASE_URL } from './client';
import { ConnectorApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => { status?: number; json?: unknown; text?: string }
): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = (init?.headers as Record<string, string>) || {};
    recorded.push({ url, method: init?.method ?? 'GET', headers, body: init?.body });
    const res = handler(url, init);
    const status = res.status ?? 200;
    const text = res.text ?? JSON.stringify(res.json ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
      async text() {
        return text;
      },
    } as unknown as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Tave ConnectorClient', () => {
  test('requires an API key', () => {
    expect(() => new ConnectorClient({})).toThrow();
  });

  test('defaults to the public base URL', () => {
    const client = new ConnectorClient({ apiKey: 'k' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  test('trims a trailing slash from a custom base URL', () => {
    const client = new ConnectorClient({ apiKey: 'k', baseUrl: 'https://example.com/v2/' });
    expect(client.getBaseUrl()).toBe('https://example.com/v2');
  });

  test('sends Bearer auth header and hits the correct URL', async () => {
    const recorded = installFetch(() => ({ json: [{ id: 1 }] }));
    const connector = new Connector({ apiKey: 'secret-key' });
    await connector.contacts.list();

    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/contacts`);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.Authorization).toBe('Bearer secret-key');
  });

  test('maps list params to query string', async () => {
    const recorded = installFetch(() => ({ json: [] }));
    const connector = new Connector({ apiKey: 'k' });
    await connector.jobs.list({ page: 2, perPage: 25, search: 'wedding', status: 'active' });

    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe('/v2/jobs');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('per_page')).toBe('25');
    expect(url.searchParams.get('search')).toBe('wedding');
    expect(url.searchParams.get('status')).toBe('active');
  });

  test('leads.create issues a POST with a JSON body', async () => {
    const recorded = installFetch(() => ({ json: { id: 99 } }));
    const connector = new Connector({ apiKey: 'k' });
    const result = await connector.leads.create({ email: 'a@b.com', first_name: 'Ada' });

    expect(result).toEqual({ id: 99 });
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/leads`);
    expect(recorded[0].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(recorded[0].body as string)).toEqual({ email: 'a@b.com', first_name: 'Ada' });
  });

  test('raw.request reaches an arbitrary endpoint', async () => {
    const recorded = installFetch(() => ({ json: { ok: true } }));
    const connector = new Connector({ apiKey: 'k' });
    await connector.raw.get('/orders', { page: 1 });

    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/orders?page=1`);
  });

  test('throws ConnectorApiError on a 401 without retrying', async () => {
    const recorded = installFetch(() => ({ status: 401, json: { message: 'Invalid token' } }));
    const connector = new Connector({ apiKey: 'bad' });

    let caught: unknown;
    try {
      await connector.contacts.list();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConnectorApiError);
    expect((caught as ConnectorApiError).statusCode).toBe(401);
    expect((caught as ConnectorApiError).isAuthError()).toBe(true);
    expect(recorded.length).toBe(1);
  });

  test('fromEnv requires TAVE_API_KEY', () => {
    const prev = process.env.TAVE_API_KEY;
    delete process.env.TAVE_API_KEY;
    try {
      expect(() => Connector.fromEnv()).toThrow();
    } finally {
      if (prev !== undefined) process.env.TAVE_API_KEY = prev;
    }
  });
});
