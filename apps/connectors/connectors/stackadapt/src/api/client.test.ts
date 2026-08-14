import { afterEach, describe, expect, test } from 'bun:test';
import { ConnectorClient, DEFAULT_REST_BASE_URL, DEFAULT_GRAPHQL_URL } from './client';

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
    } else if (rawHeaders) {
      Object.assign(headers, rawHeaders);
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers });
    const json = handler(url, init);
    return {
      ok: true,
      status: 200,
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

describe('StackAdapt ConnectorClient', () => {
  test('uses Bearer and X-Authorization headers on REST requests', async () => {
    const recorded = installFetch(() => [{ id: 1, name: 'Test Campaign' }]);
    const client = new ConnectorClient({ apiKey: 'test-api-key-12345' });
    await client.get('/campaigns');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe(`${DEFAULT_REST_BASE_URL}/campaigns`);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.Authorization).toBe('Bearer test-api-key-12345');
    expect(recorded[0].headers['X-Authorization']).toBe('test-api-key-12345');
  });

  test('GET /campaign/{id} builds the expected URL', async () => {
    const recorded = installFetch(() => ({ id: 42, name: 'Campaign 42' }));
    const client = new ConnectorClient({ apiKey: 'key' });
    await client.get('/campaign/42');

    expect(recorded[0].url).toBe(`${DEFAULT_REST_BASE_URL}/campaign/42`);
  });

  test('graphql posts to the GraphQL endpoint', async () => {
    const recorded = installFetch(() => ({ data: { campaigns: [] } }));
    const client = new ConnectorClient({ apiKey: 'key' });
    await client.graphql({ query: '{ campaigns { id name } }' });

    expect(recorded[0].url.replace(/\/$/, '')).toBe(DEFAULT_GRAPHQL_URL);
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers.Authorization).toBe('Bearer key');
  });

  test('requires an API key', () => {
    expect(() => new ConnectorClient({})).toThrow('API key is required');
  });

  test('Connector.fromEnv reads STACKADAPT_API_KEY', async () => {
    const previous = process.env.STACKADAPT_API_KEY;
    process.env.STACKADAPT_API_KEY = 'env-test-api-key-12345';
    installFetch(() => []);
    const { Connector } = await import('./index');
    const connector = Connector.fromEnv();
    expect(connector.getApiKeyPreview()).toContain('env-te');
    process.env.STACKADAPT_API_KEY = previous;
  });
});
