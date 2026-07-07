import { afterEach, describe, expect, test } from 'bun:test';
import { Connector, DEFAULT_BASE_URL } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Headers;
}

function installFetch() {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
    });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ ok: true });
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Zapier API Platform client', () => {
  test('listItems uses default base URL and Bearer auth', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'test-key' });
    await client.items.list();
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/items`);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer test-key');
  });

  test('getItem encodes item ID in path', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'test-key' });
    await client.items.get('item-1');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/items/item-1`);
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer test-key');
  });

  test('createItem POSTs JSON body to /items', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'test-key' });
    await client.items.create({ name: 'example' });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/items`);
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer test-key');
  });

  test('listEvents hits /events', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'test-key' });
    await client.events.list();
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/events`);
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer test-key');
  });

  test('search POSTs to /search', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'test-key' });
    await client.search.search({ query: 'test' });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/search`);
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer test-key');
  });

  test('custom base URL override', async () => {
    const recorded = installFetch();
    const client = new Connector({
      apiKey: 'test-key',
      baseUrl: 'https://custom.example.com/v2',
    });
    await client.items.list();
    expect(recorded[0].url).toBe('https://custom.example.com/v2/items');
  });

  test('requires API key', () => {
    expect(() => new Connector({})).toThrow('Zapier API Platform API key is required');
  });

  test('does not accept OAuth accessToken as an API key alias', () => {
    expect(() => new Connector({ accessToken: 'oauth-token' } as never)).toThrow('Zapier API Platform API key is required');
  });

  test('handles HTTP-date Retry-After values before retrying', async () => {
    let calls = 0;
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers({
            'content-type': 'application/json',
            'retry-after': 'Wed, 21 Oct 2015 07:28:00 GMT',
          }),
          async text() {
            return JSON.stringify({ message: 'rate limited' });
          },
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        async text() {
          return JSON.stringify({ ok: true });
        },
      } as Response;
    }) as unknown as typeof fetch;

    const client = new Connector({ apiKey: 'test-key' });
    await expect(client.items.list()).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  test('throws normalized timeout errors', async () => {
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }) as unknown as typeof fetch;

    const client = new Connector({ apiKey: 'test-key' });
    await expect(client.getClient().request('/items', { retries: 0, timeout: 5 })).rejects.toThrow('Request timeout after 5ms');
  });

  test('keeps timeout active while reading the response body', async () => {
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        async text() {
          return new Promise<string>((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
            setTimeout(() => reject(new Error('body read was not aborted')), 50);
          });
        },
      } as Response;
    }) as unknown as typeof fetch;

    const client = new Connector({ apiKey: 'test-key' });
    await expect(client.getClient().request('/items', { retries: 0, timeout: 5 })).rejects.toThrow('Request timeout after 5ms');
  });
});
