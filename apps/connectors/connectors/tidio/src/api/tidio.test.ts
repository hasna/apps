import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Tidio, TidioClient } from './index';

const originalFetch = globalThis.fetch;

type CapturedRequest = {
  url: URL;
  method: string;
  headers: Headers;
  body?: unknown;
};

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string' || body.length === 0) return undefined;
  return JSON.parse(body);
}

function installFetchMock(response?: Response) {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    captured.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: parseBody(init?.body),
    });
    if (response) return response.clone();
    return Response.json({ id: 'test-id' });
  }) as typeof fetch;
  return captured;
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('TidioClient', () => {
  test('requires API key', () => {
    expect(() => new TidioClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('listContacts sends X-Tidio-Openapi-Key header and query params', async () => {
    const captured = installFetchMock();
    const client = new TidioClient({ apiKey: 'test-key' });
    await client.get('/contacts', { limit: 25, updated_after: '2026-01-01T00:00:00Z' });

    const req = captured[0]!;
    expect(req.url.origin).toBe('https://api.tidio.co');
    expect(req.url.pathname).toBe('/v1/contacts');
    expect(req.method).toBe('GET');
    expect(req.headers.get('X-Tidio-Openapi-Key')).toBe('test-key');
    expect(req.headers.get('Accept')).toBe('application/json');
    expect(Object.fromEntries(req.url.searchParams.entries())).toEqual({
      limit: '25',
      updated_after: '2026-01-01T00:00:00Z',
    });
  });

  test('sendConversationMessage POSTs body with correct path', async () => {
    const captured = installFetchMock();
    const tidio = new Tidio({ apiKey: 'test-key' });
    await tidio.sendConversationMessage('conv-1', { type: 'text', content: 'hello' });

    const req = captured[0]!;
    expect(req.url.pathname).toBe('/v1/conversations/conv-1/messages');
    expect(req.method).toBe('POST');
    expect(req.headers.get('Content-Type')).toBe('application/json');
    expect(req.body).toEqual({ type: 'text', content: 'hello' });
  });

  test('createWebhook maps events in request body', async () => {
    const captured = installFetchMock();
    const tidio = new Tidio({ apiKey: 'test-key' });
    await tidio.createWebhook({
      url: 'https://example.com/hook',
      events: ['contact.created', 'message.created'],
    });

    const req = captured[0]!;
    expect(req.url.pathname).toBe('/v1/webhooks');
    expect(req.body).toEqual({
      url: 'https://example.com/hook',
      events: ['contact.created', 'message.created'],
    });
  });

  test('surfaces API error message on non-2xx', async () => {
    installFetchMock(Response.json({ message: 'invalid key' }, { status: 401 }));
    const tidio = new Tidio({ apiKey: 'test-key' });
    await expect(tidio.getProject()).rejects.toThrow('invalid key');
  });
});

describe('Tidio.fromEnv', () => {
  test('requires TIDIO_API_KEY', () => {
    const prev = process.env.TIDIO_API_KEY;
    delete process.env.TIDIO_API_KEY;
    expect(() => Tidio.fromEnv()).toThrow('TIDIO_API_KEY environment variable is required');
    if (prev) process.env.TIDIO_API_KEY = prev;
  });
});
