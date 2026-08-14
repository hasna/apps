import { afterEach, describe, expect, test } from 'bun:test';
import { ZenodoClient } from './client';
import { ZenodoApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown,
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const raw = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers;
      Object.assign(headers, raw);
    }
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const json = handler(url, init, recorded);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
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

describe('ZenodoClient', () => {
  test('searchRecords builds query URL without auth', async () => {
    const recorded = installFetch((url) => {
      expect(url).toContain('/records?');
      expect(url).toContain('q=machine+learning');
      expect(url).toContain('size=5');
      return { hits: { hits: [{ id: 1, metadata: { title: 'Test' } }], total: 1 } };
    });

    const client = new ZenodoClient({ baseUrl: 'https://zenodo.org/api' });
    const result = await client.searchRecords({ q: 'machine learning', size: 5 });

    expect(result.total).toBe(1);
    expect(result.hits[0].id).toBe(1);
    expect(recorded[0].headers.Authorization).toBeUndefined();
  });

  test('getRecord fetches a single record', async () => {
    installFetch((url) => {
      expect(url).toBe('https://zenodo.org/api/records/12345');
      return { id: 12345, metadata: { title: 'Paper' } };
    });

    const client = new ZenodoClient();
    const record = await client.getRecord(12345);
    expect(record.metadata?.title).toBe('Paper');
  });

  test('listDepositions sends Bearer token', async () => {
    const recorded = installFetch((url, init) => {
      expect(url).toBe('https://zenodo.org/api/deposit/depositions');
      expect(init?.method).toBe('GET');
      return [];
    });

    const client = new ZenodoClient({ accessToken: 'test-token' });
    const depositions = await client.listDepositions();

    expect(depositions).toEqual([]);
    expect(recorded[0].headers.Authorization).toBe('Bearer test-token');
  });

  test('createDeposition posts metadata with auth', async () => {
    const recorded = installFetch((url, init) => {
      expect(url).toBe('https://zenodo.org/api/deposit/depositions');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init?.body as string);
      expect(body.metadata.title).toBe('My dataset');
      return { id: 99, metadata: body.metadata };
    });

    const client = new ZenodoClient({ accessToken: 'tok' });
    const dep = await client.createDeposition({
      metadata: { title: 'My dataset', upload_type: 'dataset' },
    });

    expect(dep.id).toBe(99);
    expect(recorded[0].headers.Authorization).toBe('Bearer tok');
  });

  test('publishDeposition posts to actions/publish', async () => {
    const recorded = installFetch((url, init) => {
      expect(url).toBe('https://zenodo.org/api/deposit/depositions/42/actions/publish');
      expect(init?.method).toBe('POST');
      return { id: 42, state: 'done' };
    });

    const client = new ZenodoClient({ accessToken: 'tok' });
    const dep = await client.publishDeposition(42);
    expect(dep.state).toBe('done');
    expect(recorded[0].url).toContain('/actions/publish');
  });

  test('deposit endpoints require token', async () => {
    const client = new ZenodoClient();
    await expect(client.listDepositions()).rejects.toBeInstanceOf(ZenodoApiError);
  });

  test('uses custom base URL', async () => {
    installFetch((url) => {
      expect(url).toStartWith('https://sandbox.zenodo.org/api/records');
      return { hits: { hits: [], total: 0 } };
    });

    const client = new ZenodoClient({ baseUrl: 'https://sandbox.zenodo.org/api/' });
    await client.searchRecords({ q: 'test' });
  });

  test('surfaces API error messages', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      async text() {
        return JSON.stringify({ message: 'Invalid token' });
      },
    })) as unknown as typeof fetch;

    const client = new ZenodoClient({ accessToken: 'bad' });
    await expect(client.getDeposition(1)).rejects.toThrow('Invalid token');
  });
});
