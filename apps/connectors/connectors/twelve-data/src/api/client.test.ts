import { afterEach, describe, expect, test } from 'bun:test';
import { ConnectorClient } from './client';
import { ConnectorApiError } from '../types';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('ConnectorClient', () => {
  test('requires apiKey', () => {
    expect(() => new ConnectorClient({})).toThrow('Twelve Data API key is required');
  });

  test('buildUrl includes apikey query parameter', () => {
    const client = new ConnectorClient({ apiKey: 'test-key-123' });
    const url = client.buildUrl('/price', { symbol: 'AAPL' });
    expect(url).toContain('apikey=test-key-123');
    expect(url).toContain('symbol=AAPL');
    expect(url.startsWith('https://api.twelvedata.com/price')).toBe(true);
  });

  test('buildUrl respects custom baseUrl', () => {
    const client = new ConnectorClient({
      apiKey: 'test-key',
      baseUrl: 'https://custom.example.com',
    });
    const url = client.buildUrl('/quote');
    expect(url.startsWith('https://custom.example.com/quote')).toBe(true);
    expect(url).toContain('apikey=test-key');
  });

  test('get returns parsed JSON on success', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ price: '150.25' });
      },
    })) as unknown as typeof fetch;

    const client = new ConnectorClient({ apiKey: 'test-key' });
    const result = await client.get<{ price: string }>('/price', { symbol: 'AAPL' });
    expect(result.price).toBe('150.25');
  });

  test('throws ConnectorApiError on API error response', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ message: 'Invalid API key' });
      },
    })) as unknown as typeof fetch;

    const client = new ConnectorClient({ apiKey: 'bad-key' });
    await expect(client.get('/price', { symbol: 'AAPL' })).rejects.toThrow(ConnectorApiError);
  });
});
