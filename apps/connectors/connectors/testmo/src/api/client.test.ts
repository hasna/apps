import { afterEach, describe, expect, test } from 'bun:test';
import { TestmoClient, DEFAULT_BASE_URL } from './client';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function installFetch(handler: (url: string, init: RequestInit | undefined) => unknown) {
  const recorded: RecordedRequest[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(rawHeaders)) {
      for (const [key, value] of rawHeaders) {
        headers[key] = value;
      }
    } else if (rawHeaders) {
      Object.assign(headers, rawHeaders);
    }

    recorded.push({ url, method: init?.method ?? 'GET', headers });
    const json = handler(url, init);

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

describe('TestmoClient', () => {
  test('requires api key', () => {
    expect(() => new TestmoClient({ apiKey: '' })).toThrow('Testmo API key is required');
  });

  test('uses default base URL', () => {
    const client = new TestmoClient({ apiKey: 'test-key' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  test('listRuns sends Bearer auth to /runs', async () => {
    const recorded = installFetch((url) => {
      expect(url).toBe(`${DEFAULT_BASE_URL}/runs?page=1`);
      return { result: [] };
    });

    const client = new TestmoClient({ apiKey: 'secret-token' });
    await client.request('/runs', { params: { page: 1 } });

    expect(recorded[0].headers.Authorization).toBe('Bearer secret-token');
    expect(recorded[0].method).toBe('GET');
  });

  test('getRun requests /runs/{id}', async () => {
    const recorded = installFetch((url) => {
      expect(url).toBe(`${DEFAULT_BASE_URL}/runs/42`);
      return { result: { id: 42, name: 'Smoke' } };
    });

    const client = new TestmoClient({ apiKey: 'secret-token' });
    await client.request('/runs/42');

    expect(recorded[0].url).toContain('/runs/42');
  });

  test('honors base_url override', async () => {
    const customBase = 'https://acme.testmo.net/api/v1';
    const recorded = installFetch((url) => {
      expect(url).toBe(`${customBase}/runs`);
      return { result: [] };
    });

    const client = new TestmoClient({ apiKey: 'secret-token', baseUrl: customBase });
    await client.request('/runs');

    expect(recorded[0].url.startsWith(customBase)).toBe(true);
  });
});
