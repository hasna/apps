import { afterEach, describe, expect, test } from 'bun:test';
import { Connector, DEFAULT_BASE_URL } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    recorded.push({ url, method: init?.method ?? 'GET', headers, body: init?.body });
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

describe('Venafi API transport', () => {
  test('DEFAULT_BASE_URL points at Venafi v1 API', () => {
    expect(DEFAULT_BASE_URL).toBe('https://api.venafi.com/v1');
  });

  test('requires API key', () => {
    expect(() => new Connector({})).toThrow('Venafi API key is required');
  });

  test('list certificates uses Bearer auth and /v1/certificates', async () => {
    const recorded = installFetch(() => ({ certificates: [] }));
    const client = new Connector({ apiKey: 'venafi-test-key' });
    await client.certificates.list();
    expect(recorded[0].url).toBe('https://api.venafi.com/v1/certificates');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization).toBe('Bearer venafi-test-key');
  });

  test('get certificate encodes ID in path', async () => {
    const recorded = installFetch(() => ({ id: 'item-1' }));
    const client = new Connector({ apiKey: 'venafi-test-key' });
    await client.certificates.get('item-1');
    expect(recorded[0].url).toBe('https://api.venafi.com/v1/certificates/item-1');
    expect(recorded[0].headers.authorization).toBe('Bearer venafi-test-key');
  });

  test('search posts to /search with expression body', async () => {
    const recorded = installFetch(() => ({ objects: [] }));
    const client = new Connector({ apiKey: 'venafi-test-key' });
    await client.search.search({ expression: 'CN="example.com"' });
    expect(recorded[0].url).toBe('https://api.venafi.com/v1/search');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body as string)).toEqual({ expression: 'CN="example.com"' });
    expect(recorded[0].headers.authorization).toBe('Bearer venafi-test-key');
  });

  test('custom base URL from config', async () => {
    const recorded = installFetch(() => ({}));
    const client = new Connector({ apiKey: 'key', baseUrl: 'https://custom.example/v1' });
    await client.events.list();
    expect(recorded[0].url).toBe('https://custom.example/v1/events');
  });
});
