import { describe, expect, test, mock, afterEach } from 'bun:test';
import { WeightsBiasesApiPlatformClient } from './client';

describe('WeightsBiasesApiPlatformClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test('sends Bearer auth header and builds /items URL', async () => {
    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new WeightsBiasesApiPlatformClient({ apiKey: 'test-key-12345' });
    await client.get('/items', { perPage: 10 });

    expect(capturedUrl).toBe('https://api.weightsbiasesapiplatform.com/v1/items?perPage=10');
    expect(capturedHeaders).toMatchObject({
      Authorization: 'Bearer test-key-12345',
      Accept: 'application/json',
    });
  });

  test('uses custom base URL when configured', () => {
    const client = new WeightsBiasesApiPlatformClient({
      apiKey: 'key',
      baseUrl: 'https://custom.example/v1',
    });
    expect(client.getBaseUrl()).toBe('https://custom.example/v1');
  });

  test('throws when API key is missing', () => {
    expect(() => new WeightsBiasesApiPlatformClient({ apiKey: '' })).toThrow('API key is required');
  });
});
