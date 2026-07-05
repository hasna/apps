import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient, DEFAULT_BASE_URL } from './client';
import { Connector } from './index';
import { ConnectorApiError } from '../types';

const TEST_BASE_URL = 'https://custom.example.com/v1';
const mockConfig = {
  apiKey: 'test-api-key-12345',
  baseUrl: TEST_BASE_URL,
};

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
  } as Response;
}

function mockFetch(impl: () => Promise<Response>) {
  global.fetch = mock(impl) as unknown as typeof fetch;
}

function getFetchMock() {
  return global.fetch as unknown as ReturnType<typeof mock>;
}

describe('ConnectorClient', () => {
  describe('constructor', () => {
    test('throws error when api key is missing', () => {
      expect(() => new ConnectorClient({})).toThrow('API key, token, or accessToken is required');
    });

    test('creates client with valid config', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client).toBeInstanceOf(ConnectorClient);
      expect(client.getBaseUrl()).toBe(TEST_BASE_URL);
    });

    test('uses default base URL when not provided', () => {
      const client = new ConnectorClient({ apiKey: 'key' });
      expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
    });

    test('strips trailing slashes from base URL', () => {
      const client = new ConnectorClient({ apiKey: 'key', baseUrl: 'https://api.example.com/v1///' });
      expect(client.getBaseUrl()).toBe('https://api.example.com/v1');
    });
  });

  describe('getApiKeyPreview', () => {
    test('returns masked key for long keys', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('test-a...2345');
    });

    test('returns *** for short keys', () => {
      const client = new ConnectorClient({ apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
    });
  });

  describe('request methods', () => {
    let client: ConnectorClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new ConnectorClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() sends Bearer auth and hits /items', async () => {
      const mockResponse = { items: [{ id: 'item-1' }] };
      mockFetch(() => Promise.resolve(jsonResponse(mockResponse)));

      const result = await client.get('/items');

      expect(getFetchMock()).toHaveBeenCalledTimes(1);
      const [url, options] = getFetchMock().mock.calls[0];
      expect(url).toBe(`${TEST_BASE_URL}/items`);
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer test-api-key-12345');
      expect(result).toEqual(mockResponse);
    });

    test('post() creates item at /items', async () => {
      const body = { name: 'new-item' };
      mockFetch(() => Promise.resolve(jsonResponse({ id: 'item-2', ...body }, 201)));

      await client.post('/items', body);

      const [url, options] = getFetchMock().mock.calls[0];
      expect(url).toBe(`${TEST_BASE_URL}/items`);
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('get() encodes itemId path segments', async () => {
      mockFetch(() => Promise.resolve(jsonResponse({ id: 'a/b' })));

      await client.get('/items/a%2Fb');

      const [url] = getFetchMock().mock.calls[0];
      expect(url).toBe(`${TEST_BASE_URL}/items/a%2Fb`);
    });

    test('get() lists events at /events', async () => {
      mockFetch(() => Promise.resolve(jsonResponse({ events: [] })));

      await client.get('/events', { limit: 10 });

      const [url] = getFetchMock().mock.calls[0];
      expect(url).toBe(`${TEST_BASE_URL}/events?limit=10`);
    });

    test('post() searches at /search', async () => {
      const body = { query: 'deploy' };
      mockFetch(() => Promise.resolve(jsonResponse({ results: [] })));

      await client.post('/search', body);

      const [url, options] = getFetchMock().mock.calls[0];
      expect(url).toBe(`${TEST_BASE_URL}/search`);
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('request() supports custom raw path and query', async () => {
      mockFetch(() => Promise.resolve(jsonResponse({ ok: true })));

      await client.request('/custom/path', { method: 'GET', params: { foo: 'bar' } });

      const [url] = getFetchMock().mock.calls[0];
      expect(url).toBe(`${TEST_BASE_URL}/custom/path?foo=bar`);
    });

    test('throws ConnectorApiError on 4xx response', async () => {
      mockFetch(() => Promise.resolve(jsonResponse({ message: 'Not found' }, 404)));

      await expect(client.get('/items/missing')).rejects.toThrow(ConnectorApiError);
    });
  });
});

describe('Connector API modules', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch(() => Promise.resolve(jsonResponse({})));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('items.list hits GET /items', async () => {
    const connector = new Connector({ apiKey: 'key', baseUrl: mockConfig.baseUrl });
    await connector.items.list();
    const [url] = getFetchMock().mock.calls[0];
    expect(url).toContain('/items');
  });

  test('items.create hits POST /items', async () => {
    const connector = new Connector({ apiKey: 'key', baseUrl: mockConfig.baseUrl });
    await connector.items.create({ name: 'x' });
    const [, options] = getFetchMock().mock.calls[0];
    expect(options.method).toBe('POST');
  });

  test('items.get hits GET /items/{id}', async () => {
    const connector = new Connector({ apiKey: 'key', baseUrl: mockConfig.baseUrl });
    await connector.items.get('abc');
    const [url] = getFetchMock().mock.calls[0];
    expect(url).toContain('/items/abc');
  });

  test('events.list hits GET /events', async () => {
    const connector = new Connector({ apiKey: 'key', baseUrl: mockConfig.baseUrl });
    await connector.events.list();
    const [url] = getFetchMock().mock.calls[0];
    expect(url).toContain('/events');
  });

  test('search.search hits POST /search', async () => {
    const connector = new Connector({ apiKey: 'key', baseUrl: mockConfig.baseUrl });
    await connector.search.search({ query: 'test' });
    const [url, options] = getFetchMock().mock.calls[0];
    expect(url).toContain('/search');
    expect(options.method).toBe('POST');
  });

  test('raw.request uses configured base URL override', async () => {
    const connector = new Connector({
      apiKey: 'key',
      baseUrl: 'https://override.example.com/v1',
    });
    await connector.raw.request({ path: '/items', method: 'GET' });
    const [url] = getFetchMock().mock.calls[0];
    expect(url).toBe('https://override.example.com/v1/items');
  });
});
