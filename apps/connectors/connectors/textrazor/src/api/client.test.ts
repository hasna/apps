import { afterEach, describe, expect, test } from 'bun:test';
import { TextRazorClient } from './client';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler?: (recorded: RecordedRequest) => unknown) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const raw = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers;
      Object.assign(headers, raw);
    }
    const entry: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);
    const json = handler ? handler(entry) : { ok: true, language: 'eng', response: {} };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async text() {
        return JSON.stringify(json);
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TextRazorClient', () => {
  test('extractEntities posts form-urlencoded body with X-TextRazor-Key', async () => {
    const recorded = installFetch();
    const client = new TextRazorClient({ apiKey: 'test-key' });
    await client.extractEntities('Hello world');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.textrazor.com/');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers['X-TextRazor-Key']).toBe('test-key');
    expect(recorded[0].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(recorded[0].body).toBe('text=Hello+world&extractors=entities');
  });

  test('extractTopics sets topics extractor', async () => {
    const recorded = installFetch();
    const client = new TextRazorClient({ apiKey: 'test-key' });
    await client.extractTopics('Topic sample');

    expect(recorded[0].body).toBe('text=Topic+sample&extractors=topics');
  });

  test('extractSentiment sets sentiment extractor', async () => {
    const recorded = installFetch();
    const client = new TextRazorClient({ apiKey: 'test-key' });
    await client.extractSentiment('Great product');

    expect(recorded[0].body).toBe('text=Great+product&extractors=sentiment');
  });

  test('analyze forwards custom extractors and language', async () => {
    const recorded = installFetch();
    const client = new TextRazorClient({ apiKey: 'test-key' });
    await client.analyze({ text: 'Custom', extractors: 'entities,topics', language: 'eng' });

    expect(recorded[0].body).toBe('text=Custom&extractors=entities%2Ctopics&language=eng');
  });

  test('rawRequest supports custom path and query', async () => {
    const recorded = installFetch();
    const client = new TextRazorClient({ apiKey: 'test-key', baseUrl: 'https://api.textrazor.com' });
    await client.rawRequest({ method: 'GET', path: '/account/', query: { detail: 'usage' } });

    expect(recorded[0].url).toBe('https://api.textrazor.com/account/?detail=usage');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers['X-TextRazor-Key']).toBe('test-key');
  });
});
