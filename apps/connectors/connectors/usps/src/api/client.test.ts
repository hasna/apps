import { afterEach, describe, expect, test } from 'bun:test';
import { Usps, UspsClient, DEFAULT_BASE_URL } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: RecordedRequest[]) => unknown,
) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    }
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
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

describe('UspsClient', () => {
  test('requires API key', () => {
    expect(() => new UspsClient({})).toThrow('USPS API key is required');
  });

  test('uses default base URL', () => {
    const client = new UspsClient({ apiKey: 'test-key' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  test('sends Bearer authorization header', async () => {
    const recorded = installFetch(() => ({ shipments: [] }));
    const client = new UspsClient({ apiKey: 'usps-key' });
    await client.get('/shipments');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.usps.com/v1/shipments');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization).toBe('Bearer usps-key');
  });

  test('builds shipment get URL with encoded id', async () => {
    const recorded = installFetch(() => ({ id: 'item-1' }));
    const client = new UspsClient({ apiKey: 'usps-key' });
    await client.get('/shipments/item-1');

    expect(recorded[0].url).toBe('https://api.usps.com/v1/shipments/item-1');
    expect(recorded[0].headers.authorization).toBe('Bearer usps-key');
  });

  test('respects custom base URL', async () => {
    const recorded = installFetch(() => ({}));
    const client = new UspsClient({ apiKey: 'key', baseUrl: 'https://custom.example/v2/' });
    await client.get('/events');

    expect(recorded[0].url).toBe('https://custom.example/v2/events');
  });

  test('POST search sends JSON body', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const client = new UspsClient({ apiKey: 'usps-key' });
    await client.post('/search', { query: '9400' });

    expect(recorded[0].url).toBe('https://api.usps.com/v1/search');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({ query: '9400' });
  });
});

describe('Usps API', () => {
  test('listShipments hits GET /shipments', async () => {
    const recorded = installFetch(() => ({ shipments: [] }));
    const usps = new Usps({ apiKey: 'usps-key' });
    await usps.listShipments();

    expect(recorded[0].url).toBe('https://api.usps.com/v1/shipments');
    expect(recorded[0].headers.authorization).toBe('Bearer usps-key');
  });

  test('getShipment hits GET /shipments/:id', async () => {
    const recorded = installFetch(() => ({ id: 'item-1' }));
    const usps = new Usps({ apiKey: 'usps-key' });
    await usps.getShipment('item-1');

    expect(recorded[0].url).toBe('https://api.usps.com/v1/shipments/item-1');
    expect(recorded[0].headers.authorization).toBe('Bearer usps-key');
  });

  test('fromEnv requires USPS_API_KEY', () => {
    const prev = process.env.USPS_API_KEY;
    delete process.env.USPS_API_KEY;
    expect(() => Usps.fromEnv()).toThrow('USPS_API_KEY');
    if (prev) process.env.USPS_API_KEY = prev;
  });
});
