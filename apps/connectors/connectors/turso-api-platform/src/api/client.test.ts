import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TursoApiPlatformClient } from './client';
import { TursoApiPlatform } from './index';
import { TursoApiPlatformApiError } from '../types';

describe('TursoApiPlatformClient', () => {
  test('requires apiKey', () => {
    expect(() => new TursoApiPlatformClient({ apiKey: '', baseUrl: 'https://configured.example.com/v1' })).toThrow('API key is required');
  });

  test('builds canonical items URL', () => {
    const client = new TursoApiPlatformClient({ apiKey: 'test-key', baseUrl: 'https://configured.example.com/v1' });
    expect(client.buildUrl('/items')).toBe(`https://configured.example.com/v1/items`);
  });

  test('builds canonical item-by-id URL', () => {
    const client = new TursoApiPlatformClient({ apiKey: 'test-key', baseUrl: 'https://configured.example.com/v1' });
    expect(client.buildUrl('/items/item-123')).toBe(`https://configured.example.com/v1/items/item-123`);
  });

  test('respects custom base URL', () => {
    const client = new TursoApiPlatformClient({
      apiKey: 'test-key',
      baseUrl: 'https://custom.example.com/v1/',
    });
    expect(client.buildUrl('/items')).toBe('https://custom.example.com/v1/items');
  });

  test('getApiKeyPreview masks key', () => {
    const client = new TursoApiPlatformClient({ apiKey: 'abcdef1234567890', baseUrl: 'https://configured.example.com/v1' });
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
    const client = new TursoApiPlatformClient({ apiKey: 'secret-api-key', baseUrl: 'https://configured.example.com/v1' });
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
    expect(capturedUrl).toBe(`https://configured.example.com/v1/items`);
    expect(capturedHeaders?.get('Authorization')).toBe('Bearer secret-api-key');
    expect(result).toEqual([{ id: '1', name: 'alpha' }]);
  });

  test('sends Bearer authorization header on get item', async () => {
    const client = new TursoApiPlatformClient({ apiKey: 'secret-api-key', baseUrl: 'https://configured.example.com/v1' });
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

    const api = new TursoApiPlatform({ apiKey: 'secret-api-key', baseUrl: 'https://configured.example.com/v1' });
    const result = await api.getItem('item-42');

    expect(capturedUrl).toBe(`https://configured.example.com/v1/items/item-42`);
    expect(capturedHeaders?.get('Authorization')).toBe('Bearer secret-api-key');
    expect(result).toEqual({ id: 'item-42', name: 'beta' });
  });

  test('throws TursoApiPlatformApiError on HTTP error', async () => {
    const client = new TursoApiPlatformClient({ apiKey: 'secret-api-key', baseUrl: 'https://configured.example.com/v1' });

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

  test('refuses to send without a configured base URL (no default endpoint)', () => {
    expect(() => new TursoApiPlatformClient({ apiKey: 'test-key' })).toThrow(/baseUrl/);
  });
});
