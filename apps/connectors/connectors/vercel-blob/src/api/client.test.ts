import { afterEach, describe, expect, test } from 'bun:test';
import { VercelBlobClient, DEFAULT_API_URL, BLOB_API_VERSION } from './client';
import { UnsupportedBlobOperationError } from '../types';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (req: RecordedRequest) => unknown) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    } else if (Array.isArray(rawHeaders)) {
      for (const [key, value] of rawHeaders) headers[key.toLowerCase()] = value;
    } else if (rawHeaders) {
      for (const [key, value] of Object.entries(rawHeaders)) headers[key.toLowerCase()] = value;
    }

    const body = typeof init?.body === 'string' ? init.body : undefined;
    const entry = { url, method: init?.method ?? 'GET', headers, body };
    recorded.push(entry);
    const result = handler(entry);
    if (result && typeof result === 'object' && 'status' in result && 'text' in result) {
      return result as Response;
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(result ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

const TEST_TOKEN = 'vercel_blob_rw_store12345_secretpart';

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('VercelBlobClient', () => {
  test('createBlob sends Bearer auth, api version, store id, and pathname query', async () => {
    const recorded = installFetch((req) => {
      expect(req.method).toBe('PUT');
      expect(req.url).toBe(`${DEFAULT_API_URL}/?pathname=docs%2Fhello.txt`);
      expect(req.headers.authorization).toBe(`Bearer ${TEST_TOKEN}`);
      expect(req.headers['x-api-version']).toBe(BLOB_API_VERSION);
      expect(req.headers['x-vercel-blob-store-id']).toBe('store12345');
      expect(req.headers['x-vercel-blob-access']).toBe('public');
      return {
        url: 'https://store12345.public.blob.vercel-storage.com/docs/hello.txt',
        downloadUrl: 'https://store12345.public.blob.vercel-storage.com/docs/hello.txt?download=1',
        pathname: 'docs/hello.txt',
        contentType: 'text/plain',
        contentDisposition: 'inline',
        etag: 'etag-1',
      };
    });

    const client = new VercelBlobClient({ token: TEST_TOKEN });
    const result = await client.createBlob('docs/hello.txt', 'hello', { access: 'public' });
    expect(result.pathname).toBe('docs/hello.txt');
    expect(recorded).toHaveLength(1);
  });

  test('listBlobs builds query params on blob API', async () => {
    const recorded = installFetch((req) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe(`${DEFAULT_API_URL}?limit=10&prefix=images%2F&mode=folded`);
      expect(req.headers.authorization).toBe(`Bearer ${TEST_TOKEN}`);
      return { blobs: [], hasMore: false, folders: ['images/'] };
    });

    const client = new VercelBlobClient({ token: TEST_TOKEN });
    const result = await client.listBlobs({ limit: 10, prefix: 'images/', mode: 'folded' });
    expect(result.folders).toEqual(['images/']);
    expect(recorded).toHaveLength(1);
  });

  test('searchBlobs delegates to list with prefix and cursor', async () => {
    const recorded = installFetch((req) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe(`${DEFAULT_API_URL}?limit=5&prefix=docs%2F&cursor=abc`);
      return { blobs: [{ pathname: 'docs/a.txt' }], hasMore: true, cursor: 'next' };
    });

    const client = new VercelBlobClient({ token: TEST_TOKEN });
    const result = await client.searchBlobs({ prefix: 'docs/', cursor: 'abc', limit: 5 });
    expect(result.hasMore).toBe(true);
    expect(recorded).toHaveLength(1);
  });

  test('head requests metadata with url query param', async () => {
    const recorded = installFetch((req) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe(`${DEFAULT_API_URL}?url=docs%2Fhello.txt`);
      return {
        url: 'https://store12345.public.blob.vercel-storage.com/docs/hello.txt',
        downloadUrl: 'https://store12345.public.blob.vercel-storage.com/docs/hello.txt?download=1',
        pathname: 'docs/hello.txt',
        size: 5,
        contentType: 'text/plain',
        contentDisposition: 'inline',
        cacheControl: 'public, max-age=3600',
        uploadedAt: '2026-01-01T00:00:00.000Z',
        etag: 'etag-1',
      };
    });

    const client = new VercelBlobClient({ token: TEST_TOKEN });
    const result = await client.head('docs/hello.txt');
    expect(result.size).toBe(5);
    expect(recorded).toHaveLength(1);
  });

  test('getBlob downloads from blob CDN host with bearer auth', async () => {
    const recorded = installFetch((req) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe('https://store12345.private.blob.vercel-storage.com/secret.txt');
      expect(req.headers.authorization).toBe(`Bearer ${TEST_TOKEN}`);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'content-type': 'text/plain',
          'content-length': '3',
          etag: 'etag-2',
        }),
        async text() {
          return 'hey';
        },
      };
    });

    const client = new VercelBlobClient({ token: TEST_TOKEN });
    const result = await client.getBlob('secret.txt', 'private');
    expect(result?.statusCode).toBe(200);
    expect(result?.body).toBe('hey');
    expect(recorded.some((r) => r.url.includes('private.blob.vercel-storage.com'))).toBe(true);
  });

  test('listEvents throws unsupported operation error', async () => {
    const client = new VercelBlobClient({ token: TEST_TOKEN });
    await expect(client.listEvents()).rejects.toBeInstanceOf(UnsupportedBlobOperationError);
  });

  test('rawRequest rejects non-vercel.com bases', async () => {
    const client = new VercelBlobClient({ token: TEST_TOKEN });
    await expect(
      client.rawRequest('GET', 'https://api.vercel.com/v1/blob'),
    ).rejects.toThrow(/vercel.com\/api\/blob/);
  });

  test('rawRequest forwards relative paths on blob API', async () => {
    const recorded = installFetch((req) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe(`${DEFAULT_API_URL}/?limit=1`);
      return { blobs: [] };
    });

    const client = new VercelBlobClient({ token: TEST_TOKEN });
    await client.rawRequest('GET', '?limit=1');
    expect(recorded).toHaveLength(1);
  });

  test('requires token or oidc credentials', () => {
    expect(() => new VercelBlobClient({ token: '' })).toThrow();
  });
});
