import { afterEach, describe, expect, test } from 'bun:test';
import { Tinypng } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: RecordedRequest, index: number) => unknown) {
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
    const json = handler(entry, recorded.length - 1);
    return {
      ok: true,
      status: entry.url.includes('/output/') ? 200 : 201,
      statusText: entry.url.includes('/output/') ? 'OK' : 'Created',
      headers: new Headers({
        Location: entry.url.includes('/output/')
          ? 'https://storage.example.com/optimized.png'
          : 'https://api.tinify.com/output/test123',
        'Compression-Count': '1',
        'Image-Width': '640',
        'Image-Height': '480',
      }),
      async text() {
        return JSON.stringify(json ?? {});
      },
      async arrayBuffer() {
        return new Uint8Array([1, 2, 3]).buffer;
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

  test('compressAndPreserveCopyright posts preserve metadata to the output URL', async () => {
    const recorded = installFetch((_, index) =>
      index === 0 ? { output: { size: 900, type: 'image/jpeg' } } : {},
    );
    const client = new Tinypng({ apiKey: 'test-key' });
    const result = await client.compressAndPreserveCopyright('https://example.com/photo.jpg');

    expect(recorded).toHaveLength(2);
    expect(recorded[0].url).toBe('https://api.tinify.com/shrink');
    expect(JSON.parse(recorded[0].body!)).toEqual({
      source: { url: 'https://example.com/photo.jpg' },
    });
    expect(recorded[1].url).toBe('https://api.tinify.com/output/test123');
    expect(JSON.parse(recorded[1].body!)).toEqual({
      preserve: ['copyright'],
    });
    expect(result.imageWidth).toBe('640');
    expect(result.data).toBeInstanceOf(Uint8Array);
  });

  test('compressWithStore posts store options to the output URL', async () => {
    const recorded = installFetch((_, index) =>
      index === 0 ? { output: { size: 800, type: 'image/png' } } : {},
    );
    const client = new Tinypng({ apiKey: 'test-key' });
    const result = await client.compressWithStore('https://example.com/image.png', {
      service: 's3',
      aws_access_key_id: 'aws-key',
      aws_secret_access_key: 'aws-secret',
      region: 'us-east-1',
      path: 'bucket/images/image.png',
    });

    expect(recorded).toHaveLength(2);
    expect(JSON.parse(recorded[0].body!)).toEqual({
      source: { url: 'https://example.com/image.png' },
    });
    expect(recorded[1].url).toBe('https://api.tinify.com/output/test123');
    expect(JSON.parse(recorded[1].body!)).toEqual({
      store: {
        service: 's3',
        aws_access_key_id: 'aws-key',
        aws_secret_access_key: 'aws-secret',
        region: 'us-east-1',
        path: 'bucket/images/image.png',
      },
    });
    expect(result.location).toBe('https://storage.example.com/optimized.png');
  });

  test('compressWithStore rejects unsupported services', async () => {
    const client = new Tinypng({ apiKey: 'test-key' });
    await expect(
      client.compressWithStore('https://example.com/image.png', {
        service: 'dropbox' as 's3',
        path: 'bucket/image.png',
      }),
    ).rejects.toThrow('Unsupported store service');
  });

  test('compressWithStore requires provider-specific credentials', async () => {
    const client = new Tinypng({ apiKey: 'test-key' });
    await expect(
      client.compressWithStore('https://example.com/image.png', {
        service: 's3',
        path: 'bucket/image.png',
      }),
    ).rejects.toThrow('S3 store requires');
  });
});
