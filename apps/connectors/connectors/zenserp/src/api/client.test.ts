import { afterEach, describe, expect, test } from 'bun:test';
import { Zenserp } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function installFetch(handler: (url: string, init: RequestInit | undefined) => unknown) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const raw = init.headers as Record<string, string>;
      for (const [key, value] of Object.entries(raw)) {
        headers[key.toLowerCase()] = value;
      }
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers });
    const json = handler(url, init);
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

describe('ZenserpClient', () => {
  test('search sends apikey header and q query param', async () => {
    const recorded = installFetch(() => ({ organic: [] }));
    const client = new Zenserp({ apiKey: 'test-key-12345' });
    await client.search.search({ q: 'pied piper' });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].url).toContain('https://app.zenserp.com/api/v2/search');
    expect(recorded[0].url).toContain('q=pied');
    expect(recorded[0].headers.apikey).toBe('test-key-12345');
  });

  test('imageSearch sets tbm=isch', async () => {
    const recorded = installFetch(() => ({}));
    const client = new Zenserp({ apiKey: 'test-key' });
    await client.search.imageSearch({ q: 'cats' });

    expect(recorded[0].url).toContain('tbm=isch');
    expect(recorded[0].url).toContain('q=cats');
  });

  test('mapSearch sets tbm=map', async () => {
    const recorded = installFetch(() => ({}));
    const client = new Zenserp({ apiKey: 'test-key' });
    await client.search.mapSearch({ q: 'coffee shop' });

    expect(recorded[0].url).toContain('tbm=map');
  });

  test('reverseImageSearch requires image_url and sets tbm=isch', async () => {
    const recorded = installFetch(() => ({}));
    const client = new Zenserp({ apiKey: 'test-key' });
    await client.search.reverseImageSearch({
      image_url: 'https://example.com/image.jpg',
    });

    expect(recorded[0].url).toContain('image_url=');
    expect(recorded[0].url).toContain('tbm=isch');
  });

  test('reverseImageSearch throws without image_url', async () => {
    const client = new Zenserp({ apiKey: 'test-key' });
    await expect(client.search.reverseImageSearch({})).rejects.toThrow('image_url is required');
  });

  test('requires API key', () => {
    expect(() => new Zenserp({ apiKey: '' })).toThrow('API key is required');
  });

  test('rawRequest uses custom path', async () => {
    const recorded = installFetch(() => ({}));
    const client = new Zenserp({ apiKey: 'test-key', baseUrl: 'https://custom.example/api/v2' });
    await client.search.rawRequest('/batch', { q: 'test' });

    expect(recorded[0].url).toContain('https://custom.example/api/v2/batch');
  });
});
