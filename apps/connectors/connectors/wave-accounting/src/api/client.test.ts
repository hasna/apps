import { afterEach, describe, expect, test } from 'bun:test';
import { WaveGraphQLClient } from './client';
import { WaveApiError } from '../types';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (recorded: RecordedRequest) => { ok: boolean; status: number; json: unknown }
): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => {
        headers[key] = value;
      });
    }
    const entry: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);
    const result = handler(entry);
    return {
      ok: result.ok,
      status: result.status,
      json: async () => result.json,
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('WaveGraphQLClient', () => {
  const mockConfig = {
    accessToken: 'test-wave-access-token-12345',
    baseUrl: 'https://gql.waveapps.com/graphql/public',
  };

  test('throws error when access token is missing', () => {
    expect(() => new WaveGraphQLClient({ accessToken: '' })).toThrow('Access token is required');
  });

  test('getAccessTokenPreview masks long tokens', () => {
    const client = new WaveGraphQLClient(mockConfig);
    expect(client.getAccessTokenPreview()).toBe('test-w...2345');
  });

  test('getAccessTokenPreview returns *** for short tokens', () => {
    const client = new WaveGraphQLClient({ accessToken: 'short' });
    expect(client.getAccessTokenPreview()).toBe('***');
  });

  test('POSTs to GraphQL endpoint with Bearer header', async () => {
    const mockData = { user: { id: '1', defaultEmail: 'test@example.com' } };
    const recorded = installFetch(() => ({
      ok: true,
      status: 200,
      json: { data: mockData },
    }));

    const client = new WaveGraphQLClient(mockConfig);
    const query = 'query { user { id defaultEmail } }';
    const result = await client.query(query);

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://gql.waveapps.com/graphql/public');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers.authorization).toBe('Bearer test-wave-access-token-12345');
    expect(recorded[0].headers['content-type']).toBe('application/json');
    expect(JSON.parse(recorded[0].body!)).toEqual({ query, variables: undefined });
    expect(result).toEqual(mockData);
  });

  test('passes variables in request body', async () => {
    const recorded = installFetch(() => ({
      ok: true,
      status: 200,
      json: { data: { business: null } },
    }));

    const client = new WaveGraphQLClient(mockConfig);
    await client.query('query($id: ID!) { business(id: $id) { id } }', { id: 'biz-1' });

    const body = JSON.parse(recorded[0].body!);
    expect(body.variables).toEqual({ id: 'biz-1' });
  });

  test('throws WaveApiError on GraphQL errors', async () => {
    installFetch(() => ({
      ok: true,
      status: 200,
      json: { errors: [{ message: 'Unauthorized', path: ['business'] }] },
    }));

    const client = new WaveGraphQLClient(mockConfig);
    await expect(client.query('query { business { id } }')).rejects.toThrow(WaveApiError);
    await expect(client.query('query { business { id } }')).rejects.toThrow('Unauthorized');
  });

  test('throws WaveApiError when no data returned', async () => {
    installFetch(() => ({
      ok: true,
      status: 200,
      json: {},
    }));

    const client = new WaveGraphQLClient(mockConfig);
    await expect(client.query('query { user { id } }')).rejects.toThrow('No data returned');
  });

  test('throws WaveApiError on HTTP error', async () => {
    installFetch(() => ({
      ok: false,
      status: 500,
      json: { errors: [{ message: 'Server error' }] },
    }));

    const client = new WaveGraphQLClient(mockConfig);
    try {
      await client.query('query { user { id } }');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(WaveApiError);
      expect((err as WaveApiError).statusCode).toBe(500);
    }
  });
});
