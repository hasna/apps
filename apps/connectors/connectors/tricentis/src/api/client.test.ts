import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import { TricentisClient, DEFAULT_BASE_URL } from './client';

describe('TricentisClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mock.restore();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('sends Bearer auth and hits /v1/tests on list request', async () => {
    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify([{ id: 't1', name: 'Smoke' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new TricentisClient({ apiKey: 'test-key-123' });
    const result = await client.request('/tests');

    expect(capturedUrl).toBe(`${DEFAULT_BASE_URL}/tests`);
    expect(capturedHeaders).toMatchObject({ Authorization: 'Bearer test-key-123' });
    expect(result).toEqual([{ id: 't1', name: 'Smoke' }]);
  });

  test('uses custom base URL when configured', async () => {
    let capturedUrl = '';

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ id: 'evt-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new TricentisClient({
      apiKey: 'key',
      baseUrl: 'https://tenant.example.com/api/v1/',
    });
    await client.request('/events');

    expect(capturedUrl).toBe('https://tenant.example.com/api/v1/events');
  });

  test('POST /search includes JSON body', async () => {
    let capturedMethod = '';
    let capturedBody = '';

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method || '';
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new TricentisClient({ apiKey: 'key' });
    await client.request('/search', { method: 'POST', body: { query: 'login' } });

    expect(capturedMethod).toBe('POST');
    expect(JSON.parse(capturedBody)).toEqual({ query: 'login' });
  });
});
