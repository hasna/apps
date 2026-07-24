import { afterEach, describe, expect, test } from 'bun:test';
import { Vivenu } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers;
      if (h instanceof Headers) {
        h.forEach((v, k) => { headers[k] = v; });
      } else if (Array.isArray(h)) {
        for (const [k, v] of h) headers[k] = v;
      } else {
        Object.assign(headers, h);
      }
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers, body: init?.body });
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

const testConfig = {
  apiKey: 'test-api-key-12345',
  distributorType: 'TestDistributor',
};

describe('Vivenu Distribution API transport', () => {
  test('listSellers builds correct URL and query params', async () => {
    const recorded = installFetch(() => ({ docs: [], total: 0 }));
    const vivenu = new Vivenu(testConfig);
    await vivenu.distribution.listSellers({ top: 10, skip: 5 });

    expect(recorded[0].url).toContain('/api/distribution/sellers');
    expect(recorded[0].url).toContain('top=10');
    expect(recorded[0].url).toContain('skip=5');
    expect(recorded[0].method).toBe('GET');
  });

  test('sends raw Authorization and x-distributor-type headers', async () => {
    const recorded = installFetch(() => ({ docs: [], total: 0 }));
    const vivenu = new Vivenu(testConfig);
    await vivenu.distribution.listSellers();

    expect(recorded[0].headers.Authorization).toBe('test-api-key-12345');
    expect(recorded[0].headers.Authorization).not.toContain('Bearer');
    expect(recorded[0].headers['x-distributor-type']).toBe('TestDistributor');
  });

  test('getEvent encodes path segment for special characters', async () => {
    const recorded = installFetch(() => ({ eventId: 'evt/special', name: 'Test Event' }));
    const vivenu = new Vivenu(testConfig);
    await vivenu.distribution.getEvent('evt/special', { distributorId: 'dist-1' });

    expect(recorded[0].url).toContain('/api/distribution/events/evt%2Fspecial');
    expect(recorded[0].url).toContain('distributorId=dist-1');
  });

  test('listAvailabilities uses encoded event id in path', async () => {
    const recorded = installFetch(() => ({ docs: [], total: 0 }));
    const vivenu = new Vivenu(testConfig);
    await vivenu.distribution.listAvailabilities('event+id', { distributorId: 'dist-2' });

    expect(recorded[0].url).toContain('/api/distribution/events/event%2Bid/availabilities');
    expect(recorded[0].url).toContain('distributorId=dist-2');
  });

  test('createCheckout POSTs JSON body to checkout endpoint', async () => {
    const recorded = installFetch(() => ({ checkoutId: 'chk-1', status: 'NEW' }));
    const vivenu = new Vivenu(testConfig);
    const body = {
      distributorId: 'dist-3',
      tickets: [{
        offerId: 'offer-1',
        eventId: 'evt-1',
        availabilityId: 'avail-1',
        price: 25.0,
      }],
    };
    const result = await vivenu.distribution.createCheckout(body);

    expect(recorded[0].url).toContain('/api/distribution/checkout');
    expect(recorded[0].method).toBe('POST');
    const parsed = JSON.parse(recorded[0].body as string);
    expect(parsed.distributorId).toBe('dist-3');
    expect(parsed.tickets).toHaveLength(1);
    expect(parsed.tickets[0].offerId).toBe('offer-1');
    expect(result.checkoutId).toBe('chk-1');
  });

  test('requires apiKey and distributorType', () => {
    expect(() => new Vivenu({ apiKey: '', distributorType: 'type' })).toThrow('API key is required');
    expect(() => new Vivenu({ apiKey: 'key', distributorType: '' })).toThrow('Distributor type is required');
  });

  test('custom base URL is used when configured', async () => {
    const recorded = installFetch(() => ({ docs: [], total: 0 }));
    const vivenu = new Vivenu({ ...testConfig, baseUrl: 'https://custom.vivenu.com' });
    await vivenu.distribution.listSellers();

    expect(recorded[0].url).toMatch(/^https:\/\/custom\.vivenu\.com\/api\/distribution\/sellers/);
  });
});
