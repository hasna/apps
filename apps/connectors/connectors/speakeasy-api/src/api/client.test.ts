import { afterEach, describe, expect, test } from 'bun:test';
import { ConnectorClient, DEFAULT_BASE_URL } from './client';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => unknown
): RecordedRequest[] {
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
      for (const [key, value] of rawHeaders) headers[key] = value;
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

describe('Speakeasy ConnectorClient', () => {
  test('requires API key', () => {
    expect(() => new ConnectorClient({})).toThrow('Speakeasy API key is required');
  });

  test('uses default base URL and x-api-key header', async () => {
    const recorded = installFetch(() => ({ workspace_id: 'ws-123' }));
    const client = new ConnectorClient({ apiKey: 'test-key-abc' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);

    const result = await client.get('/v1/auth/validate');
    expect(result).toEqual({ workspace_id: 'ws-123' });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/v1/auth/validate`);
    expect(recorded[0].headers['x-api-key']).toBe('test-key-abc');
    expect(recorded[0].method).toBe('GET');
  });

  test('supports custom base URL without trailing slash', async () => {
    const recorded = installFetch(() => ([]));
    const client = new ConnectorClient({
      apiKey: 'k',
      baseUrl: 'https://api.prod.speakeasyapi.dev/',
    });
    await client.get('/v1/apis');
    expect(recorded[0].url).toBe('https://api.prod.speakeasyapi.dev/v1/apis');
  });

  test('accepts token alias for apiKey', async () => {
    const recorded = installFetch(() => ({}));
    const client = new ConnectorClient({ token: 'token-alias' });
    await client.get('/v1/auth/validate');
    expect(recorded[0].headers['x-api-key']).toBe('token-alias');
  });
});
