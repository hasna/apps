import { afterEach, describe, expect, test } from 'bun:test';
import { ConnectorClient } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: Recorded) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      Object.assign(headers, h);
    }
    const entry: Recorded = {
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

describe('Streak ConnectorClient', () => {
  test('requires API key', () => {
    expect(() => new ConnectorClient({})).toThrow('API key is required');
  });

  test('builds Basic auth header from apiKey:', () => {
    const client = new ConnectorClient({ apiKey: 'test-key-123' });
    const expected = `Basic ${Buffer.from('test-key-123:').toString('base64')}`;
    expect(client.getAuthHeader()).toBe(expected);
  });

  test('GET requests use /api/v1 base URL', async () => {
    const recorded = installFetch((r) => {
      expect(r.url).toBe('https://api.streak.com/api/v1/pipelines');
      expect(r.method).toBe('GET');
      expect(r.headers.Authorization).toMatch(/^Basic /);
      return [{ key: 'p1', name: 'Sales' }];
    });
    const client = new ConnectorClient({ apiKey: 'key' });
    const result = await client.get<unknown[]>('/pipelines');
    expect(result).toEqual([{ key: 'p1', name: 'Sales' }]);
    expect(recorded).toHaveLength(1);
  });

  test('PUT creates resources (Streak convention)', async () => {
    const recorded = installFetch((r) => {
      expect(r.method).toBe('PUT');
      expect(r.url).toContain('/pipelines/pipe1/boxes');
      expect(r.body).toBe(JSON.stringify({ name: 'Deal' }));
      return { key: 'box1', name: 'Deal' };
    });
    const client = new ConnectorClient({ apiKey: 'key' });
    const box = await client.put<{ key: string }>('/pipelines/pipe1/boxes', { name: 'Deal' });
    expect(box.key).toBe('box1');
    expect(recorded[0].method).toBe('PUT');
  });

  test('POST updates resources (Streak convention)', async () => {
    const recorded = installFetch((r) => {
      expect(r.method).toBe('POST');
      expect(r.url).toContain('/boxes/box1');
      return { key: 'box1', name: 'Updated' };
    });
    const client = new ConnectorClient({ apiKey: 'key' });
    const box = await client.post<{ name: string }>('/boxes/box1', { name: 'Updated' });
    expect(box.name).toBe('Updated');
    expect(recorded[0].method).toBe('POST');
  });

  test('appends query params to URL', async () => {
    const recorded = installFetch((r) => {
      expect(r.url).toContain('query=acme');
      return { results: [] };
    });
    const client = new ConnectorClient({ apiKey: 'key' });
    await client.get('/search', { query: 'acme' });
    expect(recorded[0].url).toContain('query=acme');
  });

  test('throws ConnectorApiError on non-ok response', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ error: 'Unauthorized' });
      },
    })) as unknown as typeof fetch;
    const client = new ConnectorClient({ apiKey: 'bad-key' });
    await expect(client.get('/users/me')).rejects.toMatchObject({ statusCode: 401 });
  });
});
