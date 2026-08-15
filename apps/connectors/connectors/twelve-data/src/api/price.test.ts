import { describe, expect, test } from 'bun:test';
import { ConnectorClient } from './client';
import { PriceApi } from './price';

describe('PriceApi', () => {
  test('builds price URL with symbol=AAPL', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        async text() {
          return JSON.stringify({ price: '178.50', symbol: 'AAPL' });
        },
      } as Response;
    }) as unknown as typeof fetch;

    const client = new ConnectorClient({ apiKey: 'test-key' });
    const priceApi = new PriceApi(client);
    const result = await priceApi.get({ symbol: 'AAPL' });

    expect(result.price).toBe('178.50');
    expect(capturedUrl).toContain('/price');
    expect(capturedUrl).toContain('symbol=AAPL');
    expect(capturedUrl).toContain('apikey=test-key');
  });
});
