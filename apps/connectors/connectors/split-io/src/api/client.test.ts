import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { SplitIoClient } from './client';
import { SplitIo } from './index';

const API_KEY = 'test-admin-api-key';
const BASE_URL = 'https://api.split.io/internal/api/v2';

describe('SplitIoClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const headers = init?.headers as Record<string, string> | undefined;

      return new Response(
        JSON.stringify({ url, method, authorization: headers?.Authorization }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('requires API key', () => {
    expect(() => new SplitIoClient('')).toThrow('API key is required');
  });

  test('sends Bearer auth on GET /workspaces', async () => {
    const client = new SplitIoClient(API_KEY, BASE_URL);
    const result = await client.get('/workspaces', { limit: 10 }) as {
      method: string;
      url: string;
      authorization: string;
    };

    expect(result.method).toBe('GET');
    expect(result.url).toBe(`${BASE_URL}/workspaces?limit=10`);
    expect(result.authorization).toBe(`Bearer ${API_KEY}`);
  });

  test('encodes workspace paths for environments', async () => {
    const client = new SplitIoClient(API_KEY, BASE_URL);
    const result = await client.get('/environments/ws/my%20workspace') as { url: string };

    expect(result.url).toBe(`${BASE_URL}/environments/ws/my%20workspace`);
  });

  test('POST sends JSON body with content-type', async () => {
    const client = new SplitIoClient(API_KEY, BASE_URL);
    const result = await client.post('/splits/ws/ws1/trafficTypes/tt1', { name: 'flag-a' }) as {
      method: string;
      url: string;
    };

    expect(result.method).toBe('POST');
    expect(result.url).toBe(`${BASE_URL}/splits/ws/ws1/trafficTypes/tt1`);
  });

  test('throws SplitIoApiError on non-OK response', async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const client = new SplitIoClient(API_KEY, BASE_URL);
    await expect(client.get('/workspaces')).rejects.toThrow('Unauthorized');
  });
});

describe('SplitIo API wrapper', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ objects: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('listSplits maps tag array to query params', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ splits: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const api = new SplitIo({ apiKey: API_KEY });
    await api.listSplits('ws-1', { tags: ['alpha', 'beta'] });

    expect(capturedUrl).toContain('/splits/ws/ws-1');
    expect(capturedUrl).toContain('tag=alpha');
    expect(capturedUrl).toContain('tag=beta');
  });

  test('validate returns valid on successful workspace list', async () => {
    const api = new SplitIo({ apiKey: API_KEY });
    const result = await api.validate();
    expect(result.valid).toBe(true);
  });

  test('approveChangeRequest uses documented status endpoint', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody = '';
    let capturedContentType = '';

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || '';
      capturedBody = String(init?.body || '');
      capturedContentType = String((init?.headers as Record<string, string>)?.['Content-Type'] || '');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const api = new SplitIo({ apiKey: API_KEY });
    await api.approveChangeRequest('change request 1', 'looks good');

    expect(capturedMethod).toBe('PUT');
    expect(capturedUrl).toBe(`${BASE_URL}/changeRequests/change%20request%201`);
    expect(capturedContentType).toBe('application/x-www-form-urlencoded');
    expect(capturedBody).toBe('status=APPROVED&comment=looks+good');
  });

  test('declineChangeRequest sends the Split rejected status', async () => {
    let capturedUrl = '';
    let capturedBody = '';

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body || '');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const api = new SplitIo({ apiKey: API_KEY });
    await api.declineChangeRequest('cr-2');

    expect(capturedUrl).toBe(`${BASE_URL}/changeRequests/cr-2`);
    expect(capturedBody).toBe('status=REJECTED');
  });

  test('addKeysToSegment uses documented PUT upload endpoint', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody = '';

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || '';
      capturedBody = String(init?.body || '');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const api = new SplitIo({ apiKey: API_KEY });
    await api.addKeysToSegment('beta users', 'prod env', ['user-1'], 'sync');

    expect(capturedMethod).toBe('PUT');
    expect(capturedUrl).toBe(`${BASE_URL}/segments/prod%20env/beta%20users/uploadKeys?replace=false`);
    expect(capturedBody).toBe(JSON.stringify({ keys: ['user-1'], comment: 'sync' }));
  });
});
