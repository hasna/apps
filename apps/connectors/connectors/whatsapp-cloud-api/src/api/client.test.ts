import { afterEach, describe, expect, test } from 'bun:test';
import { WhatsappCloudApi, WhatsappCloudApiClient, DEFAULT_BASE_URL } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => unknown = () => ({}),
): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const json = handler(url, init);
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

describe('WhatsappCloudApiClient', () => {
  test('uses default base URL', () => {
    const client = new WhatsappCloudApiClient({ apiKey: 'test-key' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  test('sends Bearer authorization header', async () => {
    const recorded = installFetch();
    const client = new WhatsappCloudApiClient({ apiKey: 'whatsapp-cloud-api-key' });
    await client.request('/items');
    expect(recorded[0].url).toBe('https://api.whatsappcloudapi.com/v1/items');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer whatsapp-cloud-api-key');
  });

  test('supports custom base URL', async () => {
    const recorded = installFetch();
    const client = new WhatsappCloudApiClient({
      apiKey: 'key',
      baseUrl: 'https://custom.example/v2/',
    });
    await client.request('/items');
    expect(recorded[0].url).toBe('https://custom.example/v2/items');
  });
});

describe('WhatsappCloudApi', () => {
  test('listItems calls GET /items', async () => {
    const recorded = installFetch(() => ({ items: [] }));
    const api = new WhatsappCloudApi({ apiKey: 'whatsapp-cloud-api-key' });
    await api.listItems();
    expect(recorded[0].url).toBe('https://api.whatsappcloudapi.com/v1/items');
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer whatsapp-cloud-api-key');
  });

  test('getItem calls GET /items/:itemId', async () => {
    const recorded = installFetch(() => ({ id: 'item-1' }));
    const api = new WhatsappCloudApi({ apiKey: 'whatsapp-cloud-api-key' });
    await api.getItem('item-1');
    expect(recorded[0].url).toBe('https://api.whatsappcloudapi.com/v1/items/item-1');
  });

  test('createItem posts JSON body to /items', async () => {
    const recorded = installFetch(() => ({ id: 'new' }));
    const api = new WhatsappCloudApi({ apiKey: 'key' });
    await api.createItem({ name: 'demo' });
    expect(recorded[0].url).toBe('https://api.whatsappcloudapi.com/v1/items');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({ name: 'demo' });
  });

  test('listEvents calls GET /events', async () => {
    const recorded = installFetch(() => ({ events: [] }));
    const api = new WhatsappCloudApi({ apiKey: 'key' });
    await api.listEvents();
    expect(recorded[0].url).toBe('https://api.whatsappcloudapi.com/v1/events');
  });

  test('search posts JSON body to /search', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const api = new WhatsappCloudApi({ apiKey: 'key' });
    await api.search({ query: 'hello' });
    expect(recorded[0].url).toBe('https://api.whatsappcloudapi.com/v1/search');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({ query: 'hello' });
  });

  test('rawRequest supports custom path and method', async () => {
    const recorded = installFetch(() => ({ ok: true }));
    const api = new WhatsappCloudApi({ apiKey: 'key' });
    await api.rawRequest({ path: '/custom', method: 'PUT', body: { a: 1 } });
    expect(recorded[0].url).toBe('https://api.whatsappcloudapi.com/v1/custom');
    expect(recorded[0].method).toBe('PUT');
  });

  test('requires API key', () => {
    expect(() => new WhatsappCloudApiClient({ apiKey: '' })).toThrow('API key is required');
  });
});
