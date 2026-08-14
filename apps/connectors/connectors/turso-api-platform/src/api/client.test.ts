import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TursoApiPlatformClient, DEFAULT_BASE_URL } from './client';
import { TursoApiPlatform } from './index';
import { TursoApiPlatformApiError } from '../types';

describe('TursoApiPlatformClient', () => {
  test('requires apiKey', () => {
    expect(() => new TursoApiPlatformClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('builds canonical items URL', () => {
    const client = new TursoApiPlatformClient({ apiKey: 'test-key' });
    expect(client.buildUrl('/items')).toBe(`${DEFAULT_BASE_URL}/items`);
  });

  test('builds canonical item-by-id URL', () => {
    const client = new TursoApiPlatformClient({ apiKey: 'test-key' });
    expect(client.buildUrl('/items/item-123')).toBe(`${DEFAULT_BASE_URL}/items/item-123`);
  });

  test('respects custom base URL', () => {
    const client = new TursoApiPlatformClient({
      apiKey: 'test-key',
      baseUrl: 'https://custom.example.com/v1/',
    });
    expect(client.buildUrl('/items')).toBe('https://custom.example.com/v1/items');
  });

  test('getApiKeyPreview masks key', () => {
    const client = new TursoApiPlatformClient({ apiKey: 'abcdef1234567890' });
    expect(client.getApiKeyPreview()).toBe('abcdef...7890');
  });
});

describe('TursoApiPlatformClient request', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('sends Bearer authorization header on list items', async () => {
    const client = new TursoApiPlatformClient({ apiKey: 'secret-api-key' });
    let capturedUrl = '';
    let capturedHeaders: Headers | undefined;

    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return Promise.resolve(
        new Response(JSON.stringify([{ id: '1', name: 'alpha' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;

    const result = await client.get('/items');
    expect(capturedUrl).toBe(`${DEFAULT_BASE_URL}/items`);
    expect(capturedHeaders?.get('Authorization')).toBe('Bearer secret-api-key');
    expect(result).toEqual([{ id: '1', name: 'alpha' }]);
  });

  test('sends Bearer authorization header on get item', async () => {
    const client = new TursoApiPlatformClient({ apiKey: 'secret-api-key' });
    let capturedUrl = '';
    let capturedHeaders: Headers | undefined;

    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'item-42', name: 'beta' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;

    const api = new TursoApiPlatform({ apiKey: 'secret-api-key' });
    const result = await api.getItem('item-42');

    expect(capturedUrl).toBe(`${DEFAULT_BASE_URL}/items/item-42`);
    expect(capturedHeaders?.get('Authorization')).toBe('Bearer secret-api-key');
    expect(result).toEqual({ id: 'item-42', name: 'beta' });
  });

  test('throws TursoApiPlatformApiError on HTTP error', async () => {
    const client = new TursoApiPlatformClient({ apiKey: 'secret-api-key' });

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(client.get('/items')).rejects.toThrow(TursoApiPlatformApiError);
  });
});
