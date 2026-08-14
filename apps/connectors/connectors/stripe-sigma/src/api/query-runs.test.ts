import { afterEach, describe, expect, test } from 'bun:test';
import { Connector } from './index';
import { QueryRunsApi } from './query-runs';
import { ConnectorClient } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...(headers as Record<string, string>) };
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = normalizeHeaders(init?.headers);
    recorded.push({ url, method: init?.method ?? 'GET', headers, body: init?.body as string | undefined });
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

describe('ConnectorClient', () => {
  test('throws when API key is missing', () => {
    expect(() => new ConnectorClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('sends Bearer auth and Stripe-Version on GET', async () => {
    const recorded = installFetch(() => ({
      id: 'qry_test',
      object: 'sigma.sigma_query_run',
      status: 'completed',
    }));

    const client = new ConnectorClient({ apiKey: 'sk_test_abc123xyz' });
    const result = await client.get('/sigma/query_runs/qry_test');

    expect(result).toMatchObject({ id: 'qry_test', status: 'completed' });
    expect(recorded[0].url).toBe('https://api.stripe.com/v1/sigma/query_runs/qry_test');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers?.Authorization).toBe('Bearer sk_test_abc123xyz');
    expect(recorded[0].headers?.['Stripe-Version']).toBe('2025-06-30.preview');
  });

  test('POST encodes sql as form-urlencoded body', async () => {
    const recorded = installFetch(() => ({
      id: 'qry_new',
      object: 'sigma.sigma_query_run',
      status: 'running',
    }));

    const client = new ConnectorClient({ apiKey: 'sk_test_key' });
    await client.post('/sigma/query_runs', {
      sql: 'SELECT * FROM balance_transactions LIMIT 4',
    });

    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(recorded[0].body).toBe('sql=SELECT%20*%20FROM%20balance_transactions%20LIMIT%204');
  });
});

describe('QueryRunsApi', () => {
  test('create posts to /sigma/query_runs with sql', async () => {
    const recorded = installFetch(() => ({
      id: 'qry_abc',
      object: 'sigma.sigma_query_run',
      status: 'running',
    }));

    const connector = new Connector({ apiKey: 'sk_test_sigma' });
    const run = await connector.queryRuns.create({ sql: 'SELECT 1' });

    expect(run.id).toBe('qry_abc');
    expect(recorded[0].url).toContain('/sigma/query_runs');
    expect(recorded[0].headers?.Authorization).toBe('Bearer sk_test_sigma');
  });

  test('get retrieves query run by id', async () => {
    const recorded = installFetch(() => ({
      id: 'qry_retrieve',
      object: 'sigma.sigma_query_run',
      status: 'completed',
    }));

    const api = new QueryRunsApi(new ConnectorClient({ apiKey: 'sk_test_key' }));
    const run = await api.get('qry_retrieve');

    expect(run.status).toBe('completed');
    expect(recorded[0].url).toBe('https://api.stripe.com/v1/sigma/query_runs/qry_retrieve');
  });

  test('create requires sql or from_saved_query', async () => {
    const api = new QueryRunsApi(new ConnectorClient({ apiKey: 'sk_test_key' }));
    await expect(api.create({})).rejects.toThrow('Either sql or from_saved_query is required');
  });
});
