import { afterEach, describe, expect, test } from 'bun:test';
import { Valence } from './index';
import { ValenceClient, DEFAULT_BASE_URL } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      Object.assign(headers, h);
    }
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: init?.body as string | undefined,
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

describe('ValenceClient', () => {
  test('requires api key', () => {
    expect(() => new ValenceClient({ apiKey: '' })).toThrow('Valence API key is required');
  });

  test('uses Bearer auth header and default base URL', async () => {
    const recorded = installFetch(() => ({}));
    const client = new ValenceClient({ apiKey: 'test-key-123' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
    await client.request('/markets');
    expect(recorded[0].url).toBe('https://api.valence.trade/v1/markets');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.Authorization).toBe('Bearer test-key-123');
  });

  test('respects base URL override', async () => {
    const recorded = installFetch(() => ({}));
    const client = new ValenceClient({ apiKey: 'k', baseUrl: 'https://custom.example/v2/' });
    expect(client.getBaseUrl()).toBe('https://custom.example/v2');
    await client.request('/markets');
    expect(recorded[0].url).toBe('https://custom.example/v2/markets');
  });
});

describe('Valence API methods', () => {
  const config = { apiKey: 'test-api-key' };

  test('listMarkets GET /markets', async () => {
    const recorded = installFetch(() => ({ markets: [] }));
    const valence = new Valence(config);
    await valence.markets.listMarkets();
    expect(recorded[0].url).toBe('https://api.valence.trade/v1/markets');
    expect(recorded[0].method).toBe('GET');
  });

  test('getMarket encodes market id in path', async () => {
    const recorded = installFetch(() => ({ id: 'm1' }));
    const valence = new Valence(config);
    await valence.markets.getMarket('market/with/slash');
    expect(recorded[0].url).toBe('https://api.valence.trade/v1/markets/market%2Fwith%2Fslash');
  });

  test('listOrders GET /orders', async () => {
    const recorded = installFetch(() => ({ orders: [] }));
    const valence = new Valence(config);
    await valence.orders.listOrders({ status: 'open' });
    expect(recorded[0].url).toBe('https://api.valence.trade/v1/orders?status=open');
    expect(recorded[0].method).toBe('GET');
  });

  test('createOrder POST /orders with body', async () => {
    const recorded = installFetch(() => ({ id: 'ord-1' }));
    const valence = new Valence(config);
    await valence.orders.createOrder({ marketId: 'm1', side: 'buy', size: 10 });
    expect(recorded[0].url).toBe('https://api.valence.trade/v1/orders');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({ marketId: 'm1', side: 'buy', size: 10 });
  });

  test('cancelOrder POST /orders/{id}/cancel', async () => {
    const recorded = installFetch(() => ({ status: 'cancelled' }));
    const valence = new Valence(config);
    await valence.orders.cancelOrder('order/123');
    expect(recorded[0].url).toBe('https://api.valence.trade/v1/orders/order%2F123/cancel');
    expect(recorded[0].method).toBe('POST');
  });

  test('getPositions GET /positions', async () => {
    const recorded = installFetch(() => ({ positions: [] }));
    const valence = new Valence(config);
    await valence.positions.getPositions();
    expect(recorded[0].url).toBe('https://api.valence.trade/v1/positions');
    expect(recorded[0].method).toBe('GET');
  });

  test('getBalances GET /balances', async () => {
    const recorded = installFetch(() => ({ balances: [] }));
    const valence = new Valence(config);
    await valence.balances.getBalances();
    expect(recorded[0].url).toBe('https://api.valence.trade/v1/balances');
    expect(recorded[0].method).toBe('GET');
  });

  test('listArbitrageOpportunities GET /arbitrage/opportunities', async () => {
    const recorded = installFetch(() => ({ opportunities: [] }));
    const valence = new Valence(config);
    await valence.arbitrage.listOpportunities();
    expect(recorded[0].url).toBe('https://api.valence.trade/v1/arbitrage/opportunities');
    expect(recorded[0].method).toBe('GET');
  });

  test('matchTickers POST /markets/match-tickers', async () => {
    const recorded = installFetch(() => ({ matches: [] }));
    const valence = new Valence(config);
    await valence.markets.matchTickers({ tickers: ['AAPL', 'MSFT'] });
    expect(recorded[0].url).toBe('https://api.valence.trade/v1/markets/match-tickers');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({ tickers: ['AAPL', 'MSFT'] });
  });

  test('rawRequest supports custom method, path, query, body', async () => {
    const recorded = installFetch(() => ({ ok: true }));
    const valence = new Valence(config);
    await valence.rawRequest({
      method: 'POST',
      path: '/custom',
      params: { q: '1' },
      body: { foo: 'bar' },
    });
    expect(recorded[0].url).toBe('https://api.valence.trade/v1/custom?q=1');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({ foo: 'bar' });
  });
});
