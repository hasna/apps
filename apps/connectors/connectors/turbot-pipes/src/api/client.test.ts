import { afterEach, describe, expect, test } from 'bun:test';
import { TurbotPipes, TurbotPipesClient, encodePathSegment } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: RecordedRequest[]) => unknown
) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const raw = init.headers as Record<string, string>;
      for (const [key, value] of Object.entries(raw)) {
        headers[key.toLowerCase()] = value;
      }
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

describe('TurbotPipesClient', () => {
  test('encodePathSegment encodes special characters', () => {
    expect(encodePathSegment('my org')).toBe('my%20org');
    expect(encodePathSegment('ws/handle')).toBe('ws%2Fhandle');
  });

  test('getCurrentUser uses Bearer auth and Accept application/json', async () => {
    const recorded = installFetch((url) => {
      expect(url).toBe('https://pipes.turbot.com/api/latest/user');
      return { handle: 'demo' };
    });

    const client = new TurbotPipes({ apiToken: 'test-token' });
    const user = await client.getCurrentUser();

    expect(user.handle).toBe('demo');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization).toBe('Bearer test-token');
    expect(recorded[0].headers.accept).toBe('application/json');
  });

  test('listWorkspaces encodes org handle in path', async () => {
    const recorded = installFetch(() => ({ items: [] }));

    const client = new TurbotPipes({ apiToken: 'tok' });
    await client.listWorkspaces('my org');

    expect(recorded[0].url).toBe('https://pipes.turbot.com/api/latest/org/my%20org/workspace');
  });

  test('getWorkspace encodes org and workspace handles', async () => {
    const recorded = installFetch(() => ({ handle: 'prod' }));

    const client = new TurbotPipes({ apiToken: 'tok' });
    await client.getWorkspace('acme', 'prod ws');

    expect(recorded[0].url).toBe(
      'https://pipes.turbot.com/api/latest/org/acme/workspace/prod%20ws'
    );
  });

  test('runQuery POSTs sql and optional params', async () => {
    const recorded = installFetch(() => ({ rows: [] }));

    const client = new TurbotPipes({ apiToken: 'tok' });
    await client.runQuery('acme', 'default', {
      sql: 'select 1',
      params: { region: 'us-east-1' },
    });

    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].url).toBe(
      'https://pipes.turbot.com/api/latest/org/acme/workspace/default/query'
    );
    const body = JSON.parse(recorded[0].body!);
    expect(body).toEqual({ sql: 'select 1', params: { region: 'us-east-1' } });
  });

  test('listSnapshots passes limit and next_token query params', async () => {
    const recorded = installFetch(() => ({ items: [], next_token: 'abc' }));

    const client = new TurbotPipes({ apiToken: 'tok' });
    await client.listSnapshots('acme', 'default', { limit: 10, next_token: 'page1' });

    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe('/api/latest/org/acme/workspace/default/snapshot');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('next_token')).toBe('page1');
  });

  test('requires api token', () => {
    expect(() => new TurbotPipesClient({ apiToken: '' })).toThrow('API token is required');
  });
});
