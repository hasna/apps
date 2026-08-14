import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient, DEFAULT_BASE_URL } from './client';
import { BatchesApi } from './batches';
import { Connector } from './index';
import { ConnectorApiError } from '../types';

describe('ConnectorClient', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('requires apiKey', () => {
    expect(() => new ConnectorClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('uses default base URL', () => {
    const client = new ConnectorClient({ apiKey: 'test-key' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  test('uses custom base URL and strips trailing slash', () => {
    const client = new ConnectorClient({
      apiKey: 'test-key',
      baseUrl: 'https://custom.example.com/v2/',
    });
    expect(client.getBaseUrl()).toBe('https://custom.example.com/v2');
  });

  test('buildUrl constructs batches list endpoint', () => {
    const client = new ConnectorClient({ apiKey: 'test-key' });
    expect(client.buildUrl('/batches')).toBe(`${DEFAULT_BASE_URL}/batches`);
  });

  test('buildUrl appends query parameters', () => {
    const client = new ConnectorClient({ apiKey: 'test-key' });
    const url = client.buildUrl('/batches', { limit: 10, offset: 0 });
    expect(url).toBe(`${DEFAULT_BASE_URL}/batches?limit=10&offset=0`);
  });

  test('encodePathSegment encodes special characters', () => {
    const client = new ConnectorClient({ apiKey: 'test-key' });
    expect(client.encodePathSegment('item/1')).toBe('item%2F1');
    expect(client.encodePathSegment('batch id')).toBe('batch%20id');
  });

  test('request sends Bearer authorization header', async () => {
    const client = new ConnectorClient({ apiKey: 'split-in-batches-key' });
    let capturedHeaders: Headers | undefined;

    globalThis.fetch = mock((_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return Promise.resolve(
        new Response(JSON.stringify({ batches: [] }), { status: 200 })
      );
    }) as any;

    await client.get('/batches');

    expect(capturedHeaders?.get('Authorization')).toBe('Bearer split-in-batches-key');
  });

  test('get batch builds encoded URL', async () => {
    const client = new ConnectorClient({ apiKey: 'test-key' });
    let capturedUrl = '';

    globalThis.fetch = mock((url) => {
      capturedUrl = String(url);
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'item/1' }), { status: 200 })
      );
    }) as any;

    const batches = new BatchesApi(client);
    await batches.get('item/1');

    expect(capturedUrl).toBe(`${DEFAULT_BASE_URL}/batches/item%2F1`);
  });

  test('post sends JSON body', async () => {
    const client = new ConnectorClient({ apiKey: 'test-key' });
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = mock((_url, init) => {
      capturedInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'batch-1' }), { status: 200 })
      );
    }) as any;

    await client.post('/batches', { name: 'workflow-a' });

    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.body).toBe(JSON.stringify({ name: 'workflow-a' }));
  });

  test('throws ConnectorApiError on HTTP error', async () => {
    const client = new ConnectorClient({ apiKey: 'test-key' });

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 })
      )
    ) as any;

    await expect(client.get('/batches')).rejects.toBeInstanceOf(ConnectorApiError);
  });

  test('getApiKeyPreview masks long keys', () => {
    const client = new ConnectorClient({ apiKey: 'abcdef1234567890' });
    expect(client.getApiKeyPreview()).toBe('abcdef...7890');
  });
});

describe('Connector', () => {
  test('fromEnv requires SPLIT_IN_BATCHES_API_KEY', () => {
    const original = process.env.SPLIT_IN_BATCHES_API_KEY;
    delete process.env.SPLIT_IN_BATCHES_API_KEY;

    expect(() => Connector.fromEnv()).toThrow('SPLIT_IN_BATCHES_API_KEY');

    if (original) process.env.SPLIT_IN_BATCHES_API_KEY = original;
  });

  test('exposes API modules', () => {
    const connector = new Connector({ apiKey: 'test-key' });
    expect(connector.batches).toBeDefined();
    expect(connector.events).toBeDefined();
    expect(connector.search).toBeDefined();
  });
});
