import { afterEach, describe, expect, test } from 'bun:test';
import { TipaltiClient } from './client';
import { Tipalti } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const raw = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(raw)) headers[k] = v;
    }
    recorded.push({ url, method: init?.method ?? 'GET', body: init?.body, headers });
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

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TipaltiClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://api.tipalti.com/v1',
  };

  test('throws when api key is missing', () => {
    expect(() => new TipaltiClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('get() sends Bearer auth to /v1/payees', async () => {
    const recorded = installFetch(() => ({ payees: [] }));
    const client = new TipaltiClient(mockConfig);
    await client.get('/payees');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.tipalti.com/v1/payees');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers?.Authorization).toBe('Bearer test-api-key-12345');
  });

  test('getPayee() requests /v1/payees/{id}', async () => {
    const recorded = installFetch(() => ({ id: 'payee-1', email: 'a@example.com' }));
    const tipalti = new Tipalti(mockConfig);
    const payee = await tipalti.getPayee('payee-1');

    expect(payee.id).toBe('payee-1');
    expect(recorded[0].url).toBe('https://api.tipalti.com/v1/payees/payee-1');
  });

  test('search() posts JSON body to /v1/search', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const tipalti = new Tipalti(mockConfig);
    await tipalti.search({ query: 'acme', entityType: 'payee' });

    expect(recorded[0].url).toBe('https://api.tipalti.com/v1/search');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toBe(JSON.stringify({ query: 'acme', entityType: 'payee' }));
  });
});
