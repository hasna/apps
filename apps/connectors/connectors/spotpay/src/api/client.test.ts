import { describe, test, expect, mock, beforeEach, afterEach, type Mock } from 'bun:test';
import { SpotPayClient, DEFAULT_BASE_URL } from './client';
import { SpotPay } from './index';
import { SpotPayApiError } from '../types';

function mockFetch(impl: () => Promise<Response>): Mock<() => Promise<Response>> {
  const fetchMock = mock(impl);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('SpotPayClient', () => {
  const mockConfig = {
    apiKey: 'test-spotpay-api-key-12345',
    baseUrl: 'https://api.spotpay.com/v1',
  };

  describe('constructor', () => {
    test('throws error when apiKey is missing', () => {
      expect(() => new SpotPayClient({ apiKey: '' })).toThrow('SpotPay API key is required');
    });

    test('creates client with valid config', () => {
      const client = new SpotPayClient(mockConfig);
      expect(client).toBeInstanceOf(SpotPayClient);
      expect(client.getBaseUrl()).toBe('https://api.spotpay.com/v1');
    });

    test('uses default base URL when not provided', () => {
      const client = new SpotPayClient({ apiKey: 'test-key' });
      expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
    });
  });

  describe('getApiKeyPreview', () => {
    test('returns masked key for long keys', () => {
      const client = new SpotPayClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('test-s...2345');
    });

    test('returns *** for short keys', () => {
      const client = new SpotPayClient({ apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
    });
  });

  describe('request methods', () => {
    let client: SpotPayClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new SpotPayClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get /account sends Bearer auth header', async () => {
      const mockResponse = { id: 'acc_1', currency: 'USD' };
      const fetchMock = mockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );

      const result = await client.get('/account');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.spotpay.com/v1/account');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer test-spotpay-api-key-12345');
      expect(result).toEqual(mockResponse);
    });

    test('get /transactions appends query parameters', async () => {
      const fetchMock = mockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"data":[]}'),
        } as Response),
      );

      await client.get('/transactions', { limit: 10, offset: 0 });

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('/transactions');
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=0');
    });

    test('post /transfers sends JSON body', async () => {
      const body = { amount: 100, currency: 'USDC', destination: 'wallet_1' };
      const fetchMock = mockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ id: 'tr_1', ...body })),
        } as Response),
      );

      await client.post('/transfers', body);

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.spotpay.com/v1/transfers');
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('post /payments sends JSON body', async () => {
      const body = { amount: 50, currency: 'USDC' };
      mockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ id: 'pay_1' })),
        } as Response),
      );

      await client.post('/payments', body);

      const fetchMock = global.fetch as unknown as Mock<() => Promise<Response>>;
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.spotpay.com/v1/payments');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('get /cards uses correct path', async () => {
      const fetchMock = mockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"cards":[]}'),
        } as Response),
      );

      await client.get('/cards');

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.spotpay.com/v1/cards');
    });

    test('get /exchange-rates uses correct path', async () => {
      const fetchMock = mockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"rate":1.0}'),
        } as Response),
      );

      await client.get('/exchange-rates', { from: 'USDC', to: 'EUR' });

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('/exchange-rates');
      expect(url).toContain('from=USDC');
      expect(url).toContain('to=EUR');
    });

    test('throws SpotPayApiError on failed response', async () => {
      mockFetch(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Invalid API key', code: 'unauthorized' })),
        } as Response),
      );

      await expect(client.get('/account')).rejects.toThrow(SpotPayApiError);
    });
  });
});

describe('SpotPay facade', () => {
  let originalFetch: typeof global.fetch;
  let fetchMock: Mock<() => Promise<Response>>;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = mockFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
      } as Response),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('getAccount calls /account', async () => {
    const spotpay = new SpotPay({ apiKey: 'key' });
    await spotpay.getAccount();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/account');
  });

  test('listTransactions calls /transactions', async () => {
    const spotpay = new SpotPay({ apiKey: 'key' });
    await spotpay.listTransactions();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/transactions');
  });

  test('createTransfer posts to /transfers', async () => {
    const spotpay = new SpotPay({ apiKey: 'key' });
    await spotpay.createTransfer({ amount: 1 });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/transfers');
    expect(options.method).toBe('POST');
  });

  test('createPayment posts to /payments', async () => {
    const spotpay = new SpotPay({ apiKey: 'key' });
    await spotpay.createPayment({ amount: 1 });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/payments');
    expect(options.method).toBe('POST');
  });

  test('listCards calls /cards', async () => {
    const spotpay = new SpotPay({ apiKey: 'key' });
    await spotpay.listCards();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/cards');
  });

  test('getExchangeRate calls /exchange-rates', async () => {
    const spotpay = new SpotPay({ apiKey: 'key' });
    await spotpay.getExchangeRate();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/exchange-rates');
  });
});
