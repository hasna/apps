import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TotalisClient } from './client';
import { TotalisApiError } from '../types';

describe('TotalisClient', () => {
  const mockConfig = {
    apiKey: 'totalis-test-key',
    baseUrl: 'https://api.totalis.trade',
  };

  let originalFetch: typeof global.fetch;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(impl: () => Promise<Response>): void {
    fetchMock = mock(impl);
    global.fetch = fetchMock as unknown as typeof fetch;
  }

  test('throws when authenticated request is made without API key', async () => {
    const client = new TotalisClient({ apiKey: '' });
    await expect(client.get('/v1/wallet')).rejects.toThrow('API key is required');
  });

  test('get() sends X-API-Key header and encodes query params', async () => {
    const client = new TotalisClient(mockConfig);
    mockFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ data: { balance: 10 } })),
      } as Response),
    );

    await client.get('/v1/wallet', { include: 'quotes' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.totalis.trade/v1/wallet?include=quotes');
    expect(new Headers(options.headers).get('X-API-Key')).toBe('totalis-test-key');
  });

  test('public markets list does not require API key', async () => {
    const client = new TotalisClient({ apiKey: '' });
    mockFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ data: { events: [] } })),
      } as Response),
    );

    await client.get('/markets', { category: 'sports' }, false);

    const [, options] = fetchMock.mock.calls[0];
    expect(new Headers(options.headers).get('X-API-Key')).toBeNull();
  });

  test('post() sends JSON body for quote request create', async () => {
    const client = new TotalisClient(mockConfig);
    const body = {
      legs: [
        { market_ticker: 'KXBTC-26JUN01-T72500', side: 'yes', venue: 'kalshi' },
        { market_ticker: 'KXBTC-26JUN01-T73000', side: 'no', venue: 'kalshi' },
      ],
      bet_amount: 25,
    };

    mockFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ data: { quote_request: { id: 'qr-1' } } })),
      } as Response),
    );

    await client.post('/v1/quote-requests', body);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.totalis.trade/v1/quote-requests');
    expect(options.method).toBe('POST');
    expect(options.body).toBe(JSON.stringify(body));
    expect(new Headers(options.headers).get('Content-Type')).toBe('application/json');
  });

  test('post() encodes path segments for commit flow', async () => {
    const client = new TotalisClient(mockConfig);
    const rfqId = 'rfq 1';
    const body = {
      expected_version: 3,
      displayed_quote_id: 'quote 1',
      displayed_quote_book_seq: 5,
      min_payout_odds_seen: 4.25,
    };

    mockFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ data: { status: 'committed' } })),
      } as Response),
    );

    await client.post(`/v1/quote-requests/${encodeURIComponent(rfqId)}/commit`, body);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.totalis.trade/v1/quote-requests/rfq%201/commit');
  });

  test('throws TotalisApiError on API error envelope', async () => {
    const client = new TotalisClient(mockConfig);
    mockFetch(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        text: () =>
          Promise.resolve(
            JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Quote request not found' } }),
          ),
      } as Response),
    );

    await expect(client.get('/v1/quote-requests/missing')).rejects.toThrow(TotalisApiError);
  });

  test('handles 204 No Content responses', async () => {
    const client = new TotalisClient(mockConfig);
    mockFetch(() =>
      Promise.resolve({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
      } as Response),
    );

    const result = await client.post('/v1/quote-requests/qr-1/cancel');
    expect(result).toEqual({});
  });
});
