import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient } from './client';
import { ItemsApi } from './items';

describe('ItemsApi', () => {
  let client: ConnectorClient;
  let items: ItemsApi;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    client = new ConnectorClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.sucuriapiplatform.com/v1',
    });
    items = new ItemsApi(client);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('list() calls GET /items', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"items":[]}'),
      } as Response)
    );

    await items.list({ limit: 5 });

    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toContain('/items');
    expect(url).toContain('limit=5');
    expect(options.method).toBe('GET');
  });

  test('create() calls POST /items', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"id":"1"}'),
      } as Response)
    );

    await items.create({ name: 'test' });

    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toContain('/items');
    expect(options.method).toBe('POST');
    expect(options.body).toBe(JSON.stringify({ name: 'test' }));
  });

  test('get() calls GET /items/:id', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"id":"abc"}'),
      } as Response)
    );

    await items.get('abc');

    const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toContain('/items/abc');
  });
});
