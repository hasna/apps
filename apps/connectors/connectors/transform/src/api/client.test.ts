import { afterEach, describe, expect, test } from 'bun:test';
import { TransformClient } from './client';
import { Transform } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch() {
  const recorded: RecordedRequest[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });

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

describe('TransformClient', () => {
  test('throws when API key is missing', () => {
    expect(() => new TransformClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('GET /pipelines uses Bearer auth and default base URL', async () => {
    const recorded = installFetch();
    const client = new TransformClient({ apiKey: 'transform-key' });

    await client.get('/pipelines');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.transform.com/v1/pipelines');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization).toBe('Bearer transform-key');
  });

  test('GET /pipelines/:id encodes pipeline id in path', async () => {
    const recorded = installFetch();
    const client = new TransformClient({ apiKey: 'transform-key' });

    await client.get('/pipelines/item-1');

    expect(recorded[0].url).toBe('https://api.transform.com/v1/pipelines/item-1');
    expect(recorded[0].headers.authorization).toBe('Bearer transform-key');
  });

  test('POST /search sends JSON body with Bearer auth', async () => {
    const recorded = installFetch();
    const client = new TransformClient({ apiKey: 'transform-key' });

    await client.post('/search', { query: 'pipeline status' });

    expect(recorded[0].url).toBe('https://api.transform.com/v1/search');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers.authorization).toBe('Bearer transform-key');
    expect(recorded[0].headers['content-type']).toBe('application/json');
    expect(recorded[0].body).toBe(JSON.stringify({ query: 'pipeline status' }));
  });

  test('respects custom TRANSFORM_BASE_URL', async () => {
    const recorded = installFetch();
    const client = new TransformClient({
      apiKey: 'transform-key',
      baseUrl: 'https://custom.example.com/v2/',
    });

    await client.get('/pipelines');

    expect(recorded[0].url).toBe('https://custom.example.com/v2/pipelines');
  });
});

describe('Transform connector modules', () => {
  test('pipelines.list hits /pipelines', async () => {
    const recorded = installFetch();
    const transform = new Transform({ apiKey: 'transform-key' });

    await transform.pipelines.list();

    expect(recorded[0].url).toBe('https://api.transform.com/v1/pipelines');
  });

  test('pipelines.get hits /pipelines/:id', async () => {
    const recorded = installFetch();
    const transform = new Transform({ apiKey: 'transform-key' });

    await transform.pipelines.get('pipe-42');

    expect(recorded[0].url).toBe('https://api.transform.com/v1/pipelines/pipe-42');
  });

  test('events.list hits /events', async () => {
    const recorded = installFetch();
    const transform = new Transform({ apiKey: 'transform-key' });

    await transform.events.list();

    expect(recorded[0].url).toBe('https://api.transform.com/v1/events');
  });
});
