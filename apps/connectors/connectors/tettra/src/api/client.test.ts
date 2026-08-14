import { afterEach, describe, expect, test } from 'bun:test';
import { Connector } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: Recorded) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(rawHeaders)) {
      for (const [key, value] of rawHeaders) headers[key] = value;
    } else if (rawHeaders) {
      Object.assign(headers, rawHeaders);
    }

    const entry: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);

    const json = handler(entry);
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

describe('Tettra API client', () => {
  test('listPages uses bearer auth and v1 pages URL', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe('https://api.tettra.co/v1/pages');
      expect(entry.method).toBe('GET');
      expect(entry.headers.Authorization).toBe('Bearer test-key');
      return [{ id: 1, title: 'Welcome' }];
    });

    const client = new Connector({ apiKey: 'test-key' });
    const pages = await client.pages.list();
    expect(pages).toEqual([{ id: 1, title: 'Welcome' }]);
    expect(recorded).toHaveLength(1);
  });

  test('getPage encodes page ID in path', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe('https://api.tettra.co/v1/pages/42');
      expect(entry.headers.Authorization).toBe('Bearer test-key');
      return { id: 42, title: 'Docs' };
    });

    const client = new Connector({ apiKey: 'test-key' });
    const page = await client.pages.get(42);
    expect(page.title).toBe('Docs');
    expect(recorded).toHaveLength(1);
  });

  test('search posts JSON body to /search', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe('https://api.tettra.co/v1/search');
      expect(entry.method).toBe('POST');
      expect(entry.headers.Authorization).toBe('Bearer test-key');
      expect(entry.body).toBe(JSON.stringify({ query: 'onboarding' }));
      return { results: [{ id: 7, title: 'Onboarding' }] };
    });

    const client = new Connector({ apiKey: 'test-key' });
    const result = await client.search.search({ query: 'onboarding' });
    expect(result.results).toHaveLength(1);
    expect(recorded).toHaveLength(1);
  });

  test('fromEnv requires TETTRA_API_KEY', () => {
    const previous = process.env.TETTRA_API_KEY;
    delete process.env.TETTRA_API_KEY;
    expect(() => Connector.fromEnv()).toThrow('TETTRA_API_KEY');
    if (previous) process.env.TETTRA_API_KEY = previous;
  });
});
