import { afterEach, describe, expect, test } from 'bun:test';
import { DEFAULT_BASE_URL, WriteBinaryFileClient } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Headers;
}

function installFetch(): Recorded[] {
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

describe('WriteBinaryFileClient transport', () => {
  test('listFiles uses bearer auth and default base URL', async () => {
    const recorded = installFetch();
    const client = new WriteBinaryFileClient({ apiKey: 'write-binary-file-key' });
    await client.listFiles();
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/files`);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer write-binary-file-key');
  });

  test('getFile encodes file id in path', async () => {
    const recorded = installFetch();
    const client = new WriteBinaryFileClient({ apiKey: 'write-binary-file-key' });
    await client.getFile('item-1');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/files/item-1`);
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer write-binary-file-key');
  });

  test('createFile posts JSON body', async () => {
    const recorded = installFetch();
    const client = new WriteBinaryFileClient({ apiKey: 'write-binary-file-key' });
    await client.createFile({ name: 'demo.bin' });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/files`);
    expect(recorded[0].method).toBe('POST');
  });

  test('search posts to /search', async () => {
    const recorded = installFetch();
    const client = new WriteBinaryFileClient({ apiKey: 'write-binary-file-key' });
    await client.search({ q: 'report' });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/search`);
    expect(recorded[0].method).toBe('POST');
  });

  test('rawRequest honors custom path and method', async () => {
    const recorded = installFetch();
    const client = new WriteBinaryFileClient({ apiKey: 'write-binary-file-key' });
    await client.rawRequest({ path: '/events', method: 'GET', query: { limit: 5 } });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/events?limit=5`);
    expect(recorded[0].method).toBe('GET');
  });

  test('requires api key', () => {
    expect(() => new WriteBinaryFileClient({ apiKey: '' })).toThrow('API key is required');
  });
});
