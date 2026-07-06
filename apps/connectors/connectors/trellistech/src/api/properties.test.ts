import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { PropertiesApi } from './properties';
import { TrellistechClient } from './client';

describe('PropertiesApi', () => {
  const mockConfig = {
    apiKey: 'trls_test_key',
    workspaceId: 'haven-vacation-rentals',
    baseUrl: 'https://app.trellistech.com/api/v1',
  };

  let client: TrellistechClient;
  let properties: PropertiesApi;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    client = new TrellistechClient(mockConfig);
    properties = new PropertiesApi(client);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const getFetchMock = () => global.fetch as unknown as ReturnType<typeof mock>;

  const mockFetch = (response: unknown, status = 200) => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(response)),
      } as Response)
    ) as unknown as typeof fetch;
  };

  test('list GETs workspace properties with query params', async () => {
    mockFetch({ items: [], pagination: { total: 0, limit: 50, offset: 0, hasMore: false } });

    await properties.list({ limit: 25, offset: 10, status: 'ACTIVE', q: 'milano' });

    const [url, options] = getFetchMock().mock.calls[0];
    expect(url).toContain('/workspaces/haven-vacation-rentals/properties');
    expect(url).toContain('limit=25');
    expect(url).toContain('offset=10');
    expect(url).toContain('status=ACTIVE');
    expect(url).toContain('q=milano');
    expect(options.method).toBe('GET');
  });

  test('get GETs single property by id', async () => {
    const property = { id: '11111111-1111-4111-8111-111111111111', name: 'Casa Duomo' };
    mockFetch({ property });

    const result = await properties.get('11111111-1111-4111-8111-111111111111');

    expect(result.name).toBe('Casa Duomo');
    const [url] = getFetchMock().mock.calls[0];
    expect(url).toContain('/properties/11111111-1111-4111-8111-111111111111');
  });

  test('create POSTs to properties collection', async () => {
    mockFetch({ property: { id: 'p1', name: 'New Property' } }, 201);

    await properties.create({ name: 'New Property' });

    const [url, options] = getFetchMock().mock.calls[0];
    expect(url).toContain('/workspaces/haven-vacation-rentals/properties');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ name: 'New Property' });
  });

  test('update PATCHes property', async () => {
    mockFetch({ property: { id: 'p1', name: 'Updated' } });

    await properties.update('p1', { name: 'Updated' });

    const [url, options] = getFetchMock().mock.calls[0];
    expect(url).toContain('/properties/p1');
    expect(options.method).toBe('PATCH');
  });

  test('delete DELETEs property', async () => {
    mockFetch({ deleted: true, propertyId: 'p1' });

    const result = await properties.delete('p1');

    expect(result.deleted).toBe(true);
    const [, options] = getFetchMock().mock.calls[0];
    expect(options.method).toBe('DELETE');
  });
});
