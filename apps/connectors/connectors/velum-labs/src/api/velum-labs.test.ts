import { describe, test, expect, mock } from 'bun:test';
import { VelumLabsClient, DEFAULT_BASE_URL } from './client';
import { VelumLabs } from './index';
import { VelumLabsApiError } from '../types';

describe('VelumLabsClient', () => {
  test('requires apiKey', () => {
    expect(() => new VelumLabsClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('creates client with valid config', () => {
    const client = new VelumLabsClient({ apiKey: 'test-key-1234567890' });
    expect(client).toBeDefined();
    expect(client.getApiKeyPreview()).toBe('test-k...7890');
  });

  test('builds correct default URL', () => {
    const client = new VelumLabsClient({ apiKey: 'key' });
    expect(client.buildUrl('/datasets')).toBe(`${DEFAULT_BASE_URL}/datasets`);
  });

  test('builds URL with query params', () => {
    const client = new VelumLabsClient({ apiKey: 'key' });
    const url = client.buildUrl('/events', { limit: 10, type: 'ingest' });
    expect(url).toBe(`${DEFAULT_BASE_URL}/events?limit=10&type=ingest`);
  });

  test('uses custom base URL', () => {
    const client = new VelumLabsClient({ apiKey: 'key', baseUrl: 'https://custom.example/v2' });
    expect(client.buildUrl('/datasets')).toBe('https://custom.example/v2/datasets');
  });

  test('sends Bearer authorization header', async () => {
    const client = new VelumLabsClient({ apiKey: 'secret-token-12345' });
    let capturedHeaders: Headers | undefined;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }) as any;

    await client.get('/datasets');
    expect(capturedHeaders?.get('Authorization')).toBe('Bearer secret-token-12345');

    globalThis.fetch = originalFetch;
  });

  test('throws VelumLabsApiError on HTTP error', async () => {
    const client = new VelumLabsClient({ apiKey: 'test-key-12345' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }))
    ) as any;

    await expect(client.get('/datasets')).rejects.toThrow(VelumLabsApiError);

    globalThis.fetch = originalFetch;
  });
});

describe('VelumLabs', () => {
  test('fromEnv throws without VELUM_LABS_API_KEY', () => {
    const origKey = process.env.VELUM_LABS_API_KEY;
    delete process.env.VELUM_LABS_API_KEY;

    expect(() => VelumLabs.fromEnv()).toThrow('VELUM_LABS_API_KEY environment variable is required');

    if (origKey) process.env.VELUM_LABS_API_KEY = origKey;
  });

  test('listDatasets calls GET /datasets', async () => {
    const connector = new VelumLabs({ apiKey: 'key' });
    let capturedUrl = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify([{ id: 'ds-1' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    }) as any;

    const result = await connector.listDatasets();
    expect(capturedUrl).toBe(`${DEFAULT_BASE_URL}/datasets`);
    expect(result).toEqual([{ id: 'ds-1' }]);

    globalThis.fetch = originalFetch;
  });

  test('getDataset calls GET /datasets/:id with encoded id', async () => {
    const connector = new VelumLabs({ apiKey: 'key' });
    let capturedUrl = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify({ id: 'abc/def' }), { status: 200 }));
    }) as any;

    await connector.getDataset('abc/def');
    expect(capturedUrl).toBe(`${DEFAULT_BASE_URL}/datasets/abc%2Fdef`);

    globalThis.fetch = originalFetch;
  });

  test('search calls POST /search', async () => {
    const connector = new VelumLabs({ apiKey: 'key' });
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method || '';
      capturedBody = init?.body as string;
      return Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    }) as any;

    await connector.search({ query: 'test' });
    expect(capturedUrl).toBe(`${DEFAULT_BASE_URL}/search`);
    expect(capturedMethod).toBe('POST');
    expect(JSON.parse(capturedBody)).toEqual({ query: 'test' });

    globalThis.fetch = originalFetch;
  });

  test('rawRequest supports custom path and method', async () => {
    const connector = new VelumLabs({ apiKey: 'key' });
    let capturedUrl = '';
    let capturedMethod = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method || '';
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }) as any;

    await connector.rawRequest({ path: '/events', method: 'GET', query: { limit: 5 } });
    expect(capturedUrl).toBe(`${DEFAULT_BASE_URL}/events?limit=5`);
    expect(capturedMethod).toBe('GET');

    globalThis.fetch = originalFetch;
  });
});

describe('VelumLabsApiError', () => {
  test('creates error with message and status', () => {
    const err = new VelumLabsApiError('not found', 404);
    expect(err.message).toBe('not found');
    expect(err.status).toBe(404);
    expect(err.name).toBe('VelumLabsApiError');
  });
});
