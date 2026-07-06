import { afterEach, describe, expect, test } from 'bun:test';
import { Tinypng } from './index';

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
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const entry = { url, method: init?.method ?? 'GET', headers, body };
    recorded.push(entry);
    const json = handler(entry);
    return {
      ok: true,
      status: 201,
      statusText: 'Created',
      headers: new Headers({
        Location: 'https://api.tinify.com/output/test123',
        'Compression-Count': '1',
      }),
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

describe('TinypngClient', () => {
  test('compressFromUrl POSTs to /shrink with Basic auth and source url', async () => {
    const recorded = installFetch(() => ({
      output: { size: 1000, type: 'image/png' },
    }));
    const client = new Tinypng({ apiKey: 'test-key' });
    const result = await client.compressFromUrl('https://example.com/image.png');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.tinify.com/shrink');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers.authorization).toBe(`Basic ${btoa('api:test-key')}`);
    expect(JSON.parse(recorded[0].body!)).toEqual({
      source: { url: 'https://example.com/image.png' },
    });
    expect(result.location).toBe('https://api.tinify.com/output/test123');
    expect(result.output?.type).toBe('image/png');
  });

  test('compressAndPreserveCopyright includes preserve metadata', async () => {
    const recorded = installFetch(() => ({ output: { size: 900, type: 'image/jpeg' } }));
    const client = new Tinypng({ apiKey: 'test-key' });
    await client.compressAndPreserveCopyright('https://example.com/photo.jpg');

    expect(JSON.parse(recorded[0].body!)).toEqual({
      source: { url: 'https://example.com/photo.jpg' },
      preserve: ['copyright'],
    });
  });

  test('compressWithStore includes store service', async () => {
    const recorded = installFetch(() => ({ output: { size: 800, type: 'image/png' } }));
    const client = new Tinypng({ apiKey: 'test-key' });
    await client.compressWithStore('https://example.com/image.png', 's3');

    expect(JSON.parse(recorded[0].body!)).toEqual({
      source: { url: 'https://example.com/image.png' },
      store: { service: 's3' },
    });
  });

  test('compressWithStore rejects unsupported services', async () => {
    const client = new Tinypng({ apiKey: 'test-key' });
    await expect(
      client.compressWithStore('https://example.com/image.png', 'dropbox' as 's3'),
    ).rejects.toThrow('Unsupported store service');
  });
});
