import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Connector, DEFAULT_BASE_URL } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Headers;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

function installFetch(): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
    });
    return Response.json({ ok: true });
  }) as unknown as typeof fetch;
  return recorded;
}

describe('Vector Legal API client', () => {
  test('uses default base URL and Bearer auth for list documents', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'vector-legal-api-key' });
    await client.documents.list();

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/documents`);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer vector-legal-api-key');
  });

  test('get document encodes id in path', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'vector-legal-api-key' });
    await client.documents.get('item-1');

    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/documents/item-1`);
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer vector-legal-api-key');
  });

  test('respects custom base URL from config', async () => {
    const recorded = installFetch();
    const client = new Connector({
      apiKey: 'test-key',
      baseUrl: 'https://custom.example.com/v2',
    });
    await client.events.list();

    expect(recorded[0].url).toBe('https://custom.example.com/v2/events');
  });

  test('search posts to /search with body', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'test-key' });
    await client.search.search({ query: 'nda' });

    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/search`);
    expect(recorded[0].method).toBe('POST');
  });

  test('fromEnv requires VECTOR_LEGAL_API_KEY', () => {
    const prev = process.env.VECTOR_LEGAL_API_KEY;
    delete process.env.VECTOR_LEGAL_API_KEY;
    expect(() => Connector.fromEnv()).toThrow('VECTOR_LEGAL_API_KEY');
    if (prev !== undefined) process.env.VECTOR_LEGAL_API_KEY = prev;
  });

  test('requires api key', () => {
    expect(() => new Connector({})).toThrow('API key');
  });
});
