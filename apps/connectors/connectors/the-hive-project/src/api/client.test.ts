import { afterEach, describe, expect, test } from 'bun:test';
import { TheHiveProject } from './index';
import { API_PATH_PREFIX, TheHiveProjectClient } from './client';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ ok: true });
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TheHiveProjectClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://thehive.example',
  };

  test('throws error when api key is missing', () => {
    expect(() => new TheHiveProjectClient({ baseUrl: 'https://thehive.example' })).toThrow('API key (Bearer token) is required');
  });

  test('throws error when instance base URL is missing', () => {
    expect(() => new TheHiveProjectClient({ apiKey: 'key' })).toThrow('TheHive instance base URL is required');
  });

  test('creates client with real instance root URL', () => {
    const client = new TheHiveProjectClient(mockConfig);
    expect(client).toBeInstanceOf(TheHiveProjectClient);
    expect(client.getBaseUrl()).toBe('https://thehive.example');
  });

  test('normalizes a provided /api/v1 suffix back to the instance root', () => {
    const client = new TheHiveProjectClient({
      apiKey: 'key',
      baseUrl: 'https://thehive.example/api/v1/',
    });
    expect(client.getBaseUrl()).toBe('https://thehive.example');
  });

  test('get() sends Bearer auth to documented /api/v1/case/{idOrName}', async () => {
    const recorded = installFetch();
    const client = new TheHiveProjectClient(mockConfig);
    await client.get('/case/case-1');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://thehive.example/api/v1/case/case-1');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization || recorded[0].headers.Authorization).toBe('Bearer test-api-key-12345');
  });

  test('does not duplicate /api/v1 when raw paths include the documented prefix', async () => {
    const recorded = installFetch();
    const client = new TheHiveProjectClient(mockConfig);
    await client.get('/api/v1/status');

    expect(recorded[0].url).toBe('https://thehive.example/api/v1/status');
  });

  test('post() sends X-Organisation when configured', async () => {
    const recorded = installFetch();
    const client = new TheHiveProjectClient({ ...mockConfig, organisation: 'soc' });
    await client.post('/query', { query: [{ _name: 'listCase' }] });

    expect(recorded[0].headers['x-organisation'] || recorded[0].headers['X-Organisation']).toBe('soc');
  });

  test('TheHive API facade uses documented query, case, and customEvent endpoints', async () => {
    const recorded = installFetch();
    const client = new TheHiveProject(mockConfig);

    await client.cases.list();
    await client.cases.create({ title: 'Incident' });
    await client.cases.get('case-1');
    await client.query.execute({ query: [{ _name: 'listCase' }] });
    await client.search.search({ query: [{ _name: 'listCase' }] });
    await client.events.create('case-1', { title: 'Timeline note' });
    await client.events.update('event-1', { title: 'Updated note' });
    await client.events.delete('event-1');

    const urls = recorded.map(request => request.url);
    expect(urls).toEqual([
      'https://thehive.example/api/v1/query',
      'https://thehive.example/api/v1/case',
      'https://thehive.example/api/v1/case/case-1',
      'https://thehive.example/api/v1/query',
      'https://thehive.example/api/v1/query',
      'https://thehive.example/api/v1/case/case-1/customEvent',
      'https://thehive.example/api/v1/customEvent/event-1',
      'https://thehive.example/api/v1/customEvent/event-1',
    ]);

    expect(recorded.map(request => request.method)).toEqual([
      'POST',
      'POST',
      'GET',
      'POST',
      'POST',
      'POST',
      'PATCH',
      'DELETE',
    ]);
    expect(recorded.some(request => request.url.includes('api.thehive-project.com'))).toBe(false);
    expect(recorded.some(request => /\/(cases|events|search)(\/|$)/.test(new URL(request.url).pathname))).toBe(false);
    expect(recorded.every(request => new URL(request.url).pathname.startsWith(API_PATH_PREFIX))).toBe(true);
  });
});
