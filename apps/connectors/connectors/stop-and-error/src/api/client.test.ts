import { afterEach, describe, expect, test } from 'bun:test';
import { StopAndErrorClient } from './client';
import { StopAndError } from './index';
import { StopAndErrorApiError } from '../types';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: RecordedRequest) => unknown) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    }
    const entry: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);
    const json = handler(entry);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('StopAndErrorClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://api.stop-and-error.com/v1',
  };

  test('throws when api key is missing', () => {
    expect(() => new StopAndErrorClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('getApiKeyPreview masks long keys', () => {
    const client = new StopAndErrorClient(mockConfig);
    expect(client.getApiKeyPreview()).toBe('test-a...2345');
  });

  test('listErrors GET /errors with bearer auth', async () => {
    const recorded = installFetch((req) => {
      expect(req.url).toBe('https://api.stop-and-error.com/v1/errors?limit=10');
      expect(req.method).toBe('GET');
      expect(req.headers.authorization).toBe('Bearer test-api-key-12345');
      return { data: [{ id: 'err_1', message: 'boom' }] };
    });
    const client = new StopAndErrorClient(mockConfig);
    const result = await client.get('/errors', { limit: 10 });
    expect(recorded).toHaveLength(1);
    expect(result).toEqual({ data: [{ id: 'err_1', message: 'boom' }] });
  });

  test('getError GET /errors/{id}', async () => {
    const recorded = installFetch((req) => {
      expect(req.url).toBe('https://api.stop-and-error.com/v1/errors/err_42');
      expect(req.method).toBe('GET');
      return { id: 'err_42', message: 'failed node' };
    });
    const connector = new StopAndError(mockConfig);
    const result = await connector.getError('err_42');
    expect(recorded[0].url).toContain('/errors/err_42');
    expect(result.id).toBe('err_42');
  });

  test('createError POST /errors with body', async () => {
    const recorded = installFetch((req) => {
      expect(req.url).toBe('https://api.stop-and-error.com/v1/errors');
      expect(req.method).toBe('POST');
      expect(req.headers.authorization).toBe('Bearer test-api-key-12345');
      const body = JSON.parse(req.body!);
      expect(body.message).toBe('workflow halted');
      expect(body.code).toBe('HALT');
      return { id: 'err_new', message: 'workflow halted', code: 'HALT' };
    });
    const connector = new StopAndError(mockConfig);
    const result = await connector.createError({ message: 'workflow halted', code: 'HALT' });
    expect(result.id).toBe('err_new');
    expect(recorded).toHaveLength(1);
  });

  test('listEvents GET /events', async () => {
    const recorded = installFetch((req) => {
      expect(req.url).toBe('https://api.stop-and-error.com/v1/events?errorId=err_1');
      expect(req.method).toBe('GET');
      return { data: [{ id: 'evt_1', type: 'error.created' }] };
    });
    const connector = new StopAndError(mockConfig);
    const result = await connector.listEvents({ errorId: 'err_1' });
    expect(recorded[0].url).toContain('/events');
    expect(result.data[0].type).toBe('error.created');
  });

  test('search POST /search with query body', async () => {
    const recorded = installFetch((req) => {
      expect(req.url).toBe('https://api.stop-and-error.com/v1/search');
      expect(req.method).toBe('POST');
      const body = JSON.parse(req.body!);
      expect(body.query).toBe('timeout');
      return { data: [{ id: 'err_9', message: 'timeout' }] };
    });
    const connector = new StopAndError(mockConfig);
    const result = await connector.search({ query: 'timeout' });
    expect(result.data).toHaveLength(1);
    expect(recorded).toHaveLength(1);
  });

  test('throws StopAndErrorApiError on non-ok response', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ error: 'invalid key' });
      },
    })) as unknown as typeof fetch;

    const client = new StopAndErrorClient(mockConfig);
    await expect(client.get('/errors')).rejects.toBeInstanceOf(StopAndErrorApiError);
  });

  test('rawRequest supports custom path and method', async () => {
    const recorded = installFetch((req) => {
      expect(req.url).toBe('https://api.stop-and-error.com/v1/custom?foo=bar');
      expect(req.method).toBe('PUT');
      return { ok: true };
    });
    const connector = new StopAndError(mockConfig);
    await connector.rawRequest({ method: 'PUT', path: '/custom', params: { foo: 'bar' } });
    expect(recorded).toHaveLength(1);
  });
});
