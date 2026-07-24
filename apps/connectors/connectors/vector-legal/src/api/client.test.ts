import { afterEach, describe, expect, test } from 'bun:test';
import { ConnectorClient, DEFAULT_BASE_URL } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers[lower] ?? headers[name];
}

function installFetch(handler?: (url: string, init: RequestInit | undefined) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => {
        headers[key] = value;
      });
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers });
    const json = handler ? handler(url, init) : { ok: true };
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

describe('Vector Legal API client', () => {
  test('uses default base URL and Bearer auth for GET /documents', async () => {
    const recorded = installFetch();
    const client = new ConnectorClient({ apiKey: 'vector-legal-key' });
    await client.get('/documents');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/documents`);
    expect(recorded[0].method).toBe('GET');
    expect(headerValue(recorded[0].headers, 'Authorization')).toBe('Bearer vector-legal-key');
  });

  test('uses default base URL and Bearer auth for GET /documents/:id', async () => {
    const recorded = installFetch();
    const client = new ConnectorClient({ apiKey: 'vector-legal-key' });
    await client.get('/documents/item-1');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/documents/item-1`);
    expect(recorded[0].method).toBe('GET');
    expect(headerValue(recorded[0].headers, 'Authorization')).toBe('Bearer vector-legal-key');
  });

  test('respects custom base URL override', async () => {
    const recorded = installFetch();
    const client = new ConnectorClient({
      apiKey: 'vector-legal-key',
      baseUrl: 'https://custom.example.com/v2',
    });
    await client.get('/documents');

    expect(recorded[0].url).toBe('https://custom.example.com/v2/documents');
  });

  test('requires API key', () => {
    expect(() => new ConnectorClient({})).toThrow('API key');
  });
});
