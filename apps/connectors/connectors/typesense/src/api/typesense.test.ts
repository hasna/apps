import { afterEach, describe, expect, test } from 'bun:test';
import { TypesenseClient, buildQuery } from './client';
import { Typesense } from './index';
import { TypesenseApiError } from '../types';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...(headers as Record<string, string>) };
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: RecordedRequest[]) => unknown) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: headersToRecord(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const payload = handler(url, init, recorded);
    if (typeof payload === 'string') {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async text() {
          return payload;
        },
        async json() {
          return JSON.parse(payload);
        },
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async text() {
        return JSON.stringify(payload ?? {});
      },
      async json() {
        return payload ?? {};
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('buildQuery', () => {
  test('maps snake_case params and skips empty values', () => {
    expect(buildQuery({ q: 'test', query_by: 'title', page: 2, filter_by: undefined })).toBe(
      '?q=test&query_by=title&page=2',
    );
  });
});

describe('TypesenseClient', () => {
  test('requires host and api key', () => {
    expect(() => new TypesenseClient({ host: '', apiKey: 'k' })).toThrow('host is required');
    expect(() => new TypesenseClient({ host: 'https://x.typesense.net', apiKey: '' })).toThrow('API key is required');
  });

  test('sends X-TYPESENSE-API-KEY header and strips trailing slash from host', async () => {
    const recorded = installFetch(() => ({ ok: true }));
    const client = new TypesenseClient({
      host: 'https://demo.typesense.net/',
      apiKey: 'ts-key',
    });
    await client.request('/health');
    expect(recorded[0].url).toBe('https://demo.typesense.net/health');
    expect(recorded[0].headers['x-typesense-api-key'] ?? recorded[0].headers['X-TYPESENSE-API-KEY']).toBe('ts-key');
  });

  test('encodes collection and document path segments', async () => {
    const recorded = installFetch(() => ({ id: '1' }));
    const client = new TypesenseClient({ host: 'https://demo.typesense.net', apiKey: 'k' });
    const ts = new Typesense({ host: 'https://demo.typesense.net', apiKey: 'k' });
    await ts.getDocument('books/authors', 'id/with/slash');
    expect(recorded[0].url).toContain('/collections/books%2Fauthors/documents/id%2Fwith%2Fslash');
  });

  test('import uses text/plain content type', async () => {
    const recorded = installFetch(() => '{"success":true}\n');
    const ts = new Typesense({ host: 'https://demo.typesense.net', apiKey: 'k' });
    await ts.importDocuments('books', '{"id":"1"}\n', { action: 'upsert', batchSize: 40, returnId: true });
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers['Content-Type'] ?? recorded[0].headers['content-type']).toBe('text/plain');
    expect(recorded[0].body).toBe('{"id":"1"}');
    expect(recorded[0].url).toContain('action=upsert');
    expect(recorded[0].url).toContain('batch_size=40');
    expect(recorded[0].url).toContain('return_id=true');
  });

  test('export returns raw text response', async () => {
    installFetch(() => '{"id":"1"}\n{"id":"2"}\n');
    const ts = new Typesense({ host: 'https://demo.typesense.net', apiKey: 'k' });
    const text = await ts.exportDocuments('books', { filterBy: 'id:>0' });
    expect(text).toBe('{"id":"1"}\n{"id":"2"}\n');
  });

  test('search maps query params', async () => {
    const recorded = installFetch(() => ({ found: 0, hits: [] }));
    const ts = new Typesense({ host: 'https://demo.typesense.net', apiKey: 'k' });
    await ts.search('books', { q: 'dune', queryBy: 'title,author', page: 1, perPage: 10, vectorQuery: 'embedding:([], k:5)' });
    expect(recorded[0].url).toContain('q=dune');
    expect(recorded[0].url).toContain('query_by=title%2Cauthor');
    expect(recorded[0].url).toContain('page=1');
    expect(recorded[0].url).toContain('per_page=10');
    expect(recorded[0].url).toContain('vector_query=');
  });

  test('throws TypesenseApiError on failed JSON response', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        async text() {
          return JSON.stringify({ message: 'Collection not found' });
        },
        async json() {
          return { message: 'Collection not found' };
        },
      }) as Response) as unknown as typeof fetch;
    const client = new TypesenseClient({ host: 'https://demo.typesense.net', apiKey: 'k' });
    await expect(client.request('/collections/missing')).rejects.toBeInstanceOf(TypesenseApiError);
  });
});

describe('Typesense validation guards', () => {
  test('search requires q and queryBy', async () => {
    const ts = new Typesense({ host: 'https://demo.typesense.net', apiKey: 'k' });
    await expect(ts.search('books', { q: '', queryBy: 'title' })).rejects.toThrow('q is required');
    await expect(ts.search('books', { q: 'x', queryBy: '' })).rejects.toThrow('queryBy is required');
  });

  test('multiSearch requires non-empty searches array', async () => {
    const ts = new Typesense({ host: 'https://demo.typesense.net', apiKey: 'k' });
    await expect(ts.multiSearch([])).rejects.toThrow('searches must be a non-empty object array');
  });
});

describe('Typesense.fromEnv', () => {
  const prevHost = process.env.TYPESENSE_HOST;
  const prevKey = process.env.TYPESENSE_API_KEY;

  afterEach(() => {
    if (prevHost === undefined) delete process.env.TYPESENSE_HOST;
    else process.env.TYPESENSE_HOST = prevHost;
    if (prevKey === undefined) delete process.env.TYPESENSE_API_KEY;
    else process.env.TYPESENSE_API_KEY = prevKey;
  });

  test('reads host and api key from environment', () => {
    process.env.TYPESENSE_HOST = 'https://env.typesense.net';
    process.env.TYPESENSE_API_KEY = 'env-key';
    const ts = Typesense.fromEnv();
    expect(ts.getClient().getBaseUrl()).toBe('https://env.typesense.net');
    expect(ts.getClient().getApiKey()).toBe('env-key');
  });
});
