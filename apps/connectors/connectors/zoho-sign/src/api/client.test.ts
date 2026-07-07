import { afterEach, describe, expect, test } from 'bun:test';
import { ZohoSignClient, resolveZohoSignBaseUrl } from './client';
import { ZohoSign } from './index';
import { ZohoSignApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = init?.headers
      ? Object.fromEntries(
          (init.headers instanceof Headers ? init.headers : new Headers(init.headers as HeadersInit)).entries(),
        )
      : undefined;
    recorded.push({ url, method: init?.method ?? 'GET', body: init?.body, headers });
    const json = handler(url, init, recorded);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async json() {
        return json ?? {};
      },
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

describe('resolveZohoSignBaseUrl', () => {
  test('defaults to US data center', () => {
    expect(resolveZohoSignBaseUrl()).toBe('https://sign.zoho.com/api/v1');
  });

  test('routes EU data center', () => {
    expect(resolveZohoSignBaseUrl({ dataCenter: 'eu' })).toBe('https://sign.zoho.eu/api/v1');
  });

  test('honors explicit base URL override', () => {
    expect(resolveZohoSignBaseUrl({ baseUrl: 'https://custom.example/api/v1/' })).toBe(
      'https://custom.example/api/v1',
    );
  });

  test('throws for unsupported data center', () => {
    expect(() => resolveZohoSignBaseUrl({ dataCenter: 'invalid' })).toThrow('Unsupported Zoho Sign data center');
  });
});

describe('ZohoSignClient', () => {
  test('constructor requires token', () => {
    expect(() => new ZohoSignClient({ token: '' })).toThrow('Zoho Sign token is required');
  });

  test('get() sends Zoho-oauthtoken header to com host', async () => {
    const recorded = installFetch(() => ({ status: 'success', requests: [] }));
    const client = new ZohoSignClient({ token: 'test-token-12345' });
    await client.get('/requests');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://sign.zoho.com/api/v1/requests');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers?.Authorization ?? recorded[0].headers?.authorization).toBe(
      'Zoho-oauthtoken test-token-12345',
    );
  });

  test('get() routes EU data center host', async () => {
    const recorded = installFetch(() => ({ status: 'success', requests: [] }));
    const client = new ZohoSignClient({ token: 'tok', dataCenter: 'eu' });
    await client.get('/templates', { row_count: 5 });

    expect(recorded[0].url).toBe('https://sign.zoho.eu/api/v1/templates?row_count=5');
  });

  test('post() serializes JSON body', async () => {
    const recorded = installFetch(() => ({ status: 'success' }));
    const client = new ZohoSignClient({ token: 'tok' });
    await client.post('/requests/req-1/submit', { notes: 'go' });

    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toBe(JSON.stringify({ notes: 'go' }));
  });

  test('throws ZohoSignApiError on status failure payload', async () => {
    installFetch(() => ({ status: 'failure', message: 'Invalid request', code: 4001 }));
    const client = new ZohoSignClient({ token: 'tok' });
    await expect(client.get('/requests')).rejects.toBeInstanceOf(ZohoSignApiError);
    await expect(client.get('/requests')).rejects.toThrow('Invalid request');
  });

  test('throws on HTTP error responses', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Invalid OAuth token' }),
      }) as Response) as unknown as typeof fetch;

    const client = new ZohoSignClient({ token: 'bad' });
    await expect(client.get('/account')).rejects.toThrow('Invalid OAuth token');
  });
});

describe('ZohoSign', () => {
  test('fromEnv requires ZOHO_SIGN_TOKEN', () => {
    const prev = process.env.ZOHO_SIGN_TOKEN;
    delete process.env.ZOHO_SIGN_TOKEN;
    expect(() => ZohoSign.fromEnv()).toThrow('ZOHO_SIGN_TOKEN');
    if (prev) process.env.ZOHO_SIGN_TOKEN = prev;
  });

  test('listRequests delegates to client', async () => {
    installFetch(() => ({
      status: 'success',
      requests: [{ request_id: '1', request_name: 'NDA' }],
    }));
    const sign = new ZohoSign({ token: 'tok' });
    const result = await sign.listRequests();
    expect(result.requests?.[0]?.request_id).toBe('1');
  });
});
