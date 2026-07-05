import { afterEach, describe, expect, test } from 'bun:test';
import { ConnectorClient, DEFAULT_BASE_URL, encodePathSegment } from './client';

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
      for (const [key, value] of rawHeaders) {
        headers[key] = value;
      }
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

describe('Valgo ConnectorClient', () => {
  test('encodePathSegment encodes special characters in IDs', () => {
    expect(encodePathSegment('sim/with space')).toBe('sim%2Fwith%20space');
  });

  test('sends Bearer authorization header', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.headers.Authorization).toBe('Bearer test-api-key');
      return { ok: true };
    });

    const client = new ConnectorClient({ apiKey: 'test-api-key' });
    await client.get('/simulations');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/simulations`);
    expect(recorded[0].method).toBe('GET');
  });

  test('encodes simulation ID in path', async () => {
    const recorded = installFetch(() => ({ id: 'sim-1' }));
    const client = new ConnectorClient({ apiKey: 'key' });
    await client.get(`/simulations/${encodePathSegment('sim/id')}`);

    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/simulations/sim%2Fid`);
  });

  test('passes POST JSON body for create requests', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.method).toBe('POST');
      expect(entry.body).toBe(JSON.stringify({ fleet_size: 10, scenario: 'urban' }));
      return { id: 'new-sim' };
    });

    const client = new ConnectorClient({ apiKey: 'key' });
    await client.post('/simulations', { fleet_size: 10, scenario: 'urban' });

    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/simulations`);
    expect(recorded[0].headers['Content-Type']).toBe('application/json');
  });

  test('uses custom base URL when configured', async () => {
    const recorded = installFetch(() => ({}));
    const client = new ConnectorClient({
      apiKey: 'key',
      baseUrl: 'https://custom.example/v2/',
    });
    await client.get('/routes');

    expect(recorded[0].url).toBe('https://custom.example/v2/routes');
  });

  test('requires API key', () => {
    expect(() => new ConnectorClient({})).toThrow('API key or token is required');
  });
});
