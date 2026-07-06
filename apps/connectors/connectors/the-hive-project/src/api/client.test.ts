import { afterEach, describe, expect, test } from 'bun:test';
import { TheHiveProjectClient, DEFAULT_BASE_URL } from './client';

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
    baseUrl: 'https://api.thehive-project.com/v1',
  };

  test('throws error when api key is missing', () => {
    expect(() => new TheHiveProjectClient({})).toThrow('API key (Bearer token) is required');
  });

  test('creates client with valid config', () => {
    const client = new TheHiveProjectClient(mockConfig);
    expect(client).toBeInstanceOf(TheHiveProjectClient);
    expect(client.getBaseUrl()).toBe('https://api.thehive-project.com/v1');
  });

  test('uses default base URL when not provided', () => {
    const client = new TheHiveProjectClient({ apiKey: 'key' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  test('get() sends Bearer auth to /cases', async () => {
    const recorded = installFetch();
    const client = new TheHiveProjectClient(mockConfig);
    await client.get('/cases');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.thehive-project.com/v1/cases');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization || recorded[0].headers.Authorization).toBe('Bearer test-api-key-12345');
  });

  test('get() sends request to /cases/{id}', async () => {
    const recorded = installFetch();
    const client = new TheHiveProjectClient(mockConfig);
    await client.get('/cases/case-1');

    expect(recorded[0].url).toBe('https://api.thehive-project.com/v1/cases/case-1');
  });

  test('get() sends request to /events', async () => {
    const recorded = installFetch();
    const client = new TheHiveProjectClient(mockConfig);
    await client.get('/events');

    expect(recorded[0].url).toBe('https://api.thehive-project.com/v1/events');
  });

  test('post() sends Bearer auth to /search', async () => {
    const recorded = installFetch();
    const client = new TheHiveProjectClient(mockConfig);
    await client.post('/search', { query: { _name: 'case' } });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.thehive-project.com/v1/search');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers.authorization || recorded[0].headers.Authorization).toBe('Bearer test-api-key-12345');
    expect(recorded[0].body).toBe(JSON.stringify({ query: { _name: 'case' } }));
  });
});
