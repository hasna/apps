import { afterEach, describe, expect, test } from 'bun:test';
import { ThoughtSpot, encodePathSegment } from './index';

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
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) {
        headers[k.toLowerCase()] = v;
      }
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

const BASE = 'https://example.thoughtspot.cloud/api/rest/2.0';
const TOKEN = 'test-bearer-token';

describe('ThoughtSpot REST API v2 client', () => {
  test('encodePathSegment encodes liveboard IDs with special characters', () => {
    expect(encodePathSegment('Sales & Marketing')).toBe('Sales%20%26%20Marketing');
    expect(encodePathSegment('id/with/slashes')).toBe('id%2Fwith%2Fslashes');
  });

  test('listLiveboards sends bearer auth and POST /metadata/search', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(entry.url).toBe(`${BASE}/metadata/search`);
      expect(entry.method).toBe('POST');
      const body = JSON.parse(entry.body || '{}');
      expect(body.metadata[0].type).toBe('LIVEBOARD');
      return [{ name: 'Board 1' }];
    });

    const ts = new ThoughtSpot({ apiKey: TOKEN, baseUrl: BASE });
    const result = await ts.liveboards.list();
    expect(Array.isArray(result)).toBe(true);
    expect(recorded.length).toBe(1);
  });

  test('getLiveboard encodes identifier in search body', async () => {
    const liveboardId = 'My Board/2024';
    const recorded = installFetch((entry) => {
      const body = JSON.parse(entry.body || '{}');
      expect(body.metadata[0].identifier).toBe(liveboardId);
      expect(body.include_details).toBe(true);
      return { metadata: [{ identifier: liveboardId }] };
    });

    const ts = new ThoughtSpot({ apiKey: TOKEN, baseUrl: BASE });
    await ts.liveboards.get(liveboardId);
    expect(recorded[0].url).toBe(`${BASE}/metadata/search`);
  });

  test('listEvents posts to /logs/fetch', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe(`${BASE}/logs/fetch`);
      expect(entry.method).toBe('POST');
      return { logs: [] };
    });

    const ts = new ThoughtSpot({ apiKey: TOKEN, baseUrl: BASE });
    await ts.events.list({ record_size: 10 });
    expect(recorded.length).toBe(1);
  });

  test('search.data routes to /searchdata with query_string', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe(`${BASE}/searchdata`);
      const body = JSON.parse(entry.body || '{}');
      expect(body.query_string).toBe('revenue by region');
      return { rows: [] };
    });

    const ts = new ThoughtSpot({ apiKey: TOKEN, baseUrl: BASE });
    await ts.search.search({ query_string: 'revenue by region' });
    expect(recorded.length).toBe(1);
  });

  test('rawRequest supports custom paths with encoded segments', async () => {
    const id = 'liveboard id';
    const recorded = installFetch((entry) => {
      expect(entry.url).toContain(encodePathSegment(id));
      expect(entry.headers.authorization).toBe(`Bearer ${TOKEN}`);
      return { ok: true };
    });

    const ts = new ThoughtSpot({ apiKey: TOKEN, baseUrl: BASE });
    await ts.rawRequest({
      method: 'GET',
      path: `/metadata/liveboard/${encodePathSegment(id)}`,
    });
    expect(recorded.length).toBe(1);
  });

  test('requires api key and base URL', () => {
    expect(() => new ThoughtSpot({ apiKey: '', baseUrl: BASE })).toThrow();
    expect(() => new ThoughtSpot({ apiKey: TOKEN })).toThrow();
  });
});
