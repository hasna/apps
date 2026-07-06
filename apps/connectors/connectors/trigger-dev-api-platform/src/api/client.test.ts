import { afterEach, describe, expect, test } from 'bun:test';
import { TriggerDevClient, flattenRunsListParams } from './client';
import { TriggerDevApiPlatform } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function installFetch(handler: (url: string, init: RequestInit | undefined) => unknown) {
  const recorded: Recorded[] = [];
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

describe('TriggerDevClient', () => {
  test('requires API key', () => {
    expect(() => new TriggerDevClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('sends Authorization Bearer header on list runs', async () => {
    const recorded = installFetch(() => ({ data: [], pagination: {} }));
    const client = new TriggerDevClient({ apiKey: 'tr_dev_testkey1234' });
    await client.get('/api/v1/runs');
    expect(recorded[0].headers.Authorization ?? recorded[0].headers.authorization).toBe('Bearer tr_dev_testkey1234');
    expect(recorded[0].url).toBe('https://api.trigger.dev/api/v1/runs');
    expect(recorded[0].method).toBe('GET');
  });

  test('does not add projectRef query param in the low-level client', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const client = new TriggerDevClient({
      apiKey: 'tr_pat_personal_token',
      projectRef: 'proj_abc123',
    });
    await client.get('/api/v1/runs');
    const url = new URL(recorded[0].url);
    expect(url.searchParams.get('projectRef')).toBeNull();
  });

  test('does not add projectRef for secret keys', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const client = new TriggerDevClient({
      apiKey: 'tr_dev_secretkey',
      projectRef: 'proj_abc123',
    });
    await client.get('/api/v1/runs');
    const url = new URL(recorded[0].url);
    expect(url.searchParams.get('projectRef')).toBeNull();
  });

  test('flattenRunsListParams encodes filter query params', () => {
    expect(flattenRunsListParams({
      pageSize: 25,
      status: ['QUEUED', 'EXECUTING'],
      period: '7d',
    })).toEqual({
      'page[size]': 25,
      'filter[status]': 'QUEUED,EXECUTING',
      'filter[createdAt][period]': '7d',
    });
  });
});

describe('TriggerDevApiPlatform', () => {
  test('listRuns hits /api/v1/runs with filters', async () => {
    const recorded = installFetch(() => ({ data: [{ id: 'run_1' }] }));
    const api = new TriggerDevApiPlatform({ apiKey: 'tr_dev_key' });
    const result = await api.listRuns({ status: ['COMPLETED'], pageSize: 10 });
    expect(result.data).toHaveLength(1);
    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe('/api/v1/runs');
    expect(url.searchParams.get('page[size]')).toBe('10');
    expect(url.searchParams.get('filter[status]')).toBe('COMPLETED');
  });

  test('listRuns uses project-scoped endpoint with PAT auth', async () => {
    const recorded = installFetch(() => ({ data: [{ id: 'run_1' }] }));
    const api = new TriggerDevApiPlatform({
      apiKey: 'tr_pat_personal_token',
      projectRef: 'proj_abc123',
    });
    await api.listRuns({ status: ['QUEUED'], pageSize: 5 });
    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe('/api/v1/projects/proj_abc123/runs');
    expect(url.searchParams.get('page[size]')).toBe('5');
    expect(url.searchParams.get('filter[status]')).toBe('QUEUED');
  });

  test('listRuns requires projectRef with PAT auth', async () => {
    const api = new TriggerDevApiPlatform({ apiKey: 'tr_pat_personal_token' });
    await expect(api.listRuns()).rejects.toThrow('projectRef is required');
  });

  test('secret-key-only operations reject PAT auth before request', async () => {
    const recorded = installFetch(() => ({ id: 'run_new' }));
    const api = new TriggerDevApiPlatform({
      apiKey: 'tr_pat_personal_token',
      projectRef: 'proj_abc123',
    });
    await expect(api.triggerTask('my-task', { payload: {} })).rejects.toThrow('requires a Trigger.dev project secret key');
    expect(recorded).toHaveLength(0);
  });

  test('triggerTask posts to task trigger endpoint', async () => {
    const recorded = installFetch(() => ({ id: 'run_new' }));
    const api = new TriggerDevApiPlatform({ apiKey: 'tr_dev_key' });
    const result = await api.triggerTask('my-task', { payload: { hello: 'world' } });
    expect(result.id).toBe('run_new');
    expect(recorded[0].url).toContain('/api/v1/tasks/my-task/trigger');
    expect(recorded[0].method).toBe('POST');
  });

  test('executeQuery posts TRQL body', async () => {
    const recorded = installFetch(() => ({ format: 'json', results: [] }));
    const api = new TriggerDevApiPlatform({ apiKey: 'tr_dev_key' });
    await api.executeQuery({
      query: 'SELECT run_id FROM runs LIMIT 5',
      period: '7d',
    });
    expect(recorded[0].url).toContain('/api/v1/query');
    expect(recorded[0].method).toBe('POST');
  });
});
