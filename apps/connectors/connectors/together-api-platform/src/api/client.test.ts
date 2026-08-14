import { afterEach, describe, expect, test } from 'bun:test';
import { TogetherApiPlatformClient } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    recorded.push({ url, method: init?.method ?? 'GET', headers });
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

function authHeader(recorded: Recorded[]): string | undefined {
  const headers = recorded[0]?.headers ?? {};
  return headers.Authorization ?? headers.authorization;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TogetherApiPlatformClient', () => {
  test('listItems calls GET /v1/items with Bearer auth', async () => {
    const recorded = installFetch(() => ({}));
    const client = new TogetherApiPlatformClient({ apiKey: 'together-api-platform-key' });
    await client.listItems();
    expect(recorded[0].url).toBe('https://api.togetherapiplatform.com/v1/items');
    expect(recorded[0].method).toBe('GET');
    expect(authHeader(recorded)).toBe('Bearer together-api-platform-key');
  });

  test('getItem calls GET /v1/items/:itemId', async () => {
    const recorded = installFetch(() => ({}));
    const client = new TogetherApiPlatformClient({ apiKey: 'together-api-platform-key' });
    await client.getItem('item-1');
    expect(recorded[0].url).toBe('https://api.togetherapiplatform.com/v1/items/item-1');
    expect(authHeader(recorded)).toBe('Bearer together-api-platform-key');
  });

  test('search posts to /v1/search', async () => {
    const recorded = installFetch(() => ({}));
    const client = new TogetherApiPlatformClient({ apiKey: 'test-key' });
    await client.search({ q: 'hello' });
    expect(recorded[0].url).toBe('https://api.togetherapiplatform.com/v1/search');
    expect(recorded[0].method).toBe('POST');
  });

  test('respects custom base URL', async () => {
    const recorded = installFetch(() => ({}));
    const client = new TogetherApiPlatformClient({
      apiKey: 'test-key',
      baseUrl: 'https://custom.example.com/v1',
    });
    await client.listEvents();
    expect(recorded[0].url).toBe('https://custom.example.com/v1/events');
  });

  test('requires API key', () => {
    expect(() => new TogetherApiPlatformClient({ apiKey: '' })).toThrow('API key is required');
  });
});
