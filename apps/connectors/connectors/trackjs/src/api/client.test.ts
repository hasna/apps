import { describe, expect, test, mock, afterEach } from 'bun:test';
import { TrackjsClient } from './client';

describe('TrackjsClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test('includes customer ID in request URL and sends raw Authorization header', async () => {
    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ data: [], metadata: { page: 1, size: 20, hasMore: false } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new TrackjsClient({
      apiKey: 'test-api-key',
      customerId: 'cust-123',
    });

    await client.get('/errors', { page: 1 });

    expect(capturedUrl).toBe('https://api.trackjs.com/cust-123/v1/errors?page=1');
    expect(capturedHeaders).toEqual({
      Accept: 'application/json',
      Authorization: 'test-api-key',
    });
  });

  test('can authenticate with key query parameter when configured', async () => {
    let capturedUrl = '';

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ data: [], metadata: { page: 1, size: 20, hasMore: false } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new TrackjsClient({
      apiKey: 'test-api-key',
      customerId: 'cust-456',
      useKeyQueryParam: true,
    });

    await client.get('/errors/messages');

    expect(capturedUrl).toBe('https://api.trackjs.com/cust-456/v1/errors/messages?key=test-api-key');
  });

  test('requires api key and customer id', () => {
    expect(() => new TrackjsClient({ apiKey: '', customerId: 'x' })).toThrow('API key');
    expect(() => new TrackjsClient({ apiKey: 'k', customerId: '' })).toThrow('customer ID');
  });
});
