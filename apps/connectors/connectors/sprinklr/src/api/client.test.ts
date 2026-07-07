import { afterEach, describe, expect, test } from 'bun:test';
import { Sprinklr, SprinklrClient } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers,
      body: init?.body ?? null,
    });
    const json = handler(url, init, recorded);
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

describe('Sprinklr API transport', () => {
  test('requires api key', () => {
    expect(() => new SprinklrClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('listCases GETs /cases with Bearer auth', async () => {
    const recorded = installFetch((url) => {
      if (url.endsWith('/cases')) return { data: [{ id: 'case-1' }] };
      return {};
    });

    const client = new Sprinklr({ apiKey: 'sprinklr-test-key' });
    const result = await client.listCases();

    expect(result).toEqual({ data: [{ id: 'case-1' }] });
    expect(recorded[0].url).toBe('https://api.sprinklr.com/v1/cases');
    expect(recorded[0].method).toBe('GET');
    expect(new Headers(recorded[0].headers).get('Authorization')).toBe('Bearer sprinklr-test-key');
  });

  test('getCase GETs /cases/:id with encoded path', async () => {
    const recorded = installFetch((url) => {
      if (url.includes('/cases/item%201')) return { id: 'item 1' };
      return {};
    });

    const client = new Sprinklr({ apiKey: 'sprinklr-test-key' });
    const result = await client.getCase('item 1');

    expect(result).toEqual({ id: 'item 1' });
    expect(recorded[0].url).toBe('https://api.sprinklr.com/v1/cases/item%201');
    expect(new Headers(recorded[0].headers).get('Authorization')).toBe('Bearer sprinklr-test-key');
  });

  test('createCase POSTs JSON body to /cases', async () => {
    const recorded = installFetch((url) => {
      if (url.endsWith('/cases')) return { id: 'new-case' };
      return {};
    });

    const client = new Sprinklr({ apiKey: 'sprinklr-test-key' });
    const result = await client.createCase({ subject: 'Support request' });

    expect(result).toEqual({ id: 'new-case' });
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body as string)).toEqual({ subject: 'Support request' });
  });

  test('listEvents GETs /events', async () => {
    const recorded = installFetch((url) => {
      if (url.endsWith('/events')) return { data: [{ id: 'event-1' }] };
      return {};
    });

    const client = new Sprinklr({ apiKey: 'sprinklr-test-key' });
    await client.listEvents({ limit: 10 });

    expect(recorded[0].url).toBe('https://api.sprinklr.com/v1/events?limit=10');
    expect(recorded[0].method).toBe('GET');
  });

  test('search POSTs to /search', async () => {
    const recorded = installFetch((url) => {
      if (url.endsWith('/search')) return { results: [] };
      return {};
    });

    const client = new Sprinklr({ apiKey: 'sprinklr-test-key' });
    await client.search({ query: 'billing' });

    expect(recorded[0].url).toBe('https://api.sprinklr.com/v1/search');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body as string)).toEqual({ query: 'billing' });
  });

  test('rawRequest honors custom path and method', async () => {
    const recorded = installFetch(() => ({ ok: true }));

    const client = new Sprinklr({
      apiKey: 'sprinklr-test-key',
      baseUrl: 'https://api.example.com/v2',
    });
    await client.rawRequest({ method: 'DELETE', path: '/cases/42' });

    expect(recorded[0].url).toBe('https://api.example.com/v2/cases/42');
    expect(recorded[0].method).toBe('DELETE');
  });

  test('fromEnv reads SPRINKLR_API_KEY and SPRINKLR_BASE_URL', () => {
    const prevKey = process.env.SPRINKLR_API_KEY;
    const prevBase = process.env.SPRINKLR_BASE_URL;
    process.env.SPRINKLR_API_KEY = 'env-test-api-key';
    process.env.SPRINKLR_BASE_URL = 'https://custom.example/v1';

    const client = Sprinklr.fromEnv();
    expect(client.getApiKeyPreview()).toMatch(/^env-te/);
    expect(client.getBaseUrl()).toBe('https://custom.example/v1');

    if (prevKey === undefined) delete process.env.SPRINKLR_API_KEY;
    else process.env.SPRINKLR_API_KEY = prevKey;
    if (prevBase === undefined) delete process.env.SPRINKLR_BASE_URL;
    else process.env.SPRINKLR_BASE_URL = prevBase;
  });
});
