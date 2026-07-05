import { afterEach, describe, expect, test } from 'bun:test';
import { VerdexClient, DEFAULT_BASE_URL } from './client';
import { Verdex } from './index';
import { VerdexApiError } from '../types';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => unknown,
): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const raw = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(raw)) headers[k] = v;
    }
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
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

describe('VerdexClient', () => {
  test('requires apiKey', () => {
    expect(() => new VerdexClient({ apiKey: '' })).toThrow('Verdex API key is required');
  });

  test('uses default base URL', () => {
    const client = new VerdexClient({ apiKey: 'test-key' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  test('allows base URL override', () => {
    const client = new VerdexClient({ apiKey: 'test-key', baseUrl: 'https://custom.example/v2/' });
    expect(client.getBaseUrl()).toBe('https://custom.example/v2');
  });

  test('sends Bearer authorization header', async () => {
    const recorded = installFetch(() => ({ ok: true }));
    const client = new VerdexClient({ apiKey: 'secret-token' });
    await client.get('/claims');
    expect(recorded[0].headers.Authorization).toBe('Bearer secret-token');
  });

  test('GET /claims builds correct URL', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const client = new VerdexClient({ apiKey: 'key' });
    await client.get('/claims', { status: 'open', limit: 10 });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/claims?status=open&limit=10`);
    expect(recorded[0].method).toBe('GET');
  });

  test('POST includes JSON body', async () => {
    const recorded = installFetch(() => ({ id: 'ver-1' }));
    const client = new VerdexClient({ apiKey: 'key' });
    await client.post('/claims/clm-1/verifications', { type: 'satellite' });
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toBe(JSON.stringify({ type: 'satellite' }));
  });

  test('throws VerdexApiError on HTTP error', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'application/json' }),
        async text() {
          return JSON.stringify({ message: 'Invalid token' });
        },
      }) as Response) as unknown as typeof fetch;

    const client = new VerdexClient({ apiKey: 'bad-key' });
    await expect(client.get('/claims')).rejects.toBeInstanceOf(VerdexApiError);
  });
});

describe('Verdex API', () => {
  test('listClaims hits /claims', async () => {
    const recorded = installFetch(() => ({ data: [{ id: 'c1' }] }));
    const api = new Verdex({ apiKey: 'key' });
    const result = await api.listClaims();
    expect(result.data).toEqual([{ id: 'c1' }]);
    expect(recorded[0].url).toContain('/claims');
  });

  test('getClaim encodes claim ID', async () => {
    const recorded = installFetch(() => ({ id: 'claim/1' }));
    const api = new Verdex({ apiKey: 'key' });
    await api.getClaim('claim/1');
    expect(recorded[0].url).toContain('/claims/claim%2F1');
  });

  test('createVerification POSTs to claim verifications endpoint', async () => {
    const recorded = installFetch(() => ({ id: 'v1' }));
    const api = new Verdex({ apiKey: 'key' });
    await api.createVerification('clm-9', { priority: 'high' });
    expect(recorded[0].url).toContain('/claims/clm-9/verifications');
    expect(recorded[0].method).toBe('POST');
  });

  test('getVerification hits /verifications/:id', async () => {
    const recorded = installFetch(() => ({ id: 'v1' }));
    const api = new Verdex({ apiKey: 'key' });
    await api.getVerification('v1');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/verifications/v1`);
  });

  test('listPortfolios hits /portfolios', async () => {
    const recorded = installFetch(() => ({ items: [] }));
    const api = new Verdex({ apiKey: 'key' });
    await api.listPortfolios();
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/portfolios`);
  });

  test('getSiteConditions hits /sites/:id/conditions', async () => {
    const recorded = installFetch(() => ({ site_id: 's1' }));
    const api = new Verdex({ apiKey: 'key' });
    await api.getSiteConditions('s1');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/sites/s1/conditions`);
  });

  test('runMonitoringCheck POSTs to /monitoring-jobs/:id/run', async () => {
    const recorded = installFetch(() => ({ status: 'queued' }));
    const api = new Verdex({ apiKey: 'key' });
    await api.runMonitoringCheck('job-7');
    expect(recorded[0].url).toContain('/monitoring-jobs/job-7/run');
    expect(recorded[0].method).toBe('POST');
  });

  test('rawRequest supports custom path and method', async () => {
    const recorded = installFetch(() => ({ ok: true }));
    const api = new Verdex({ apiKey: 'key' });
    await api.rawRequest({ method: 'DELETE', path: '/claims/x', query: { force: true } });
    expect(recorded[0].method).toBe('DELETE');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/claims/x?force=true`);
  });

  test('fromEnv requires VERDEX_API_KEY', () => {
    const prev = process.env.VERDEX_API_KEY;
    delete process.env.VERDEX_API_KEY;
    expect(() => Verdex.fromEnv()).toThrow('VERDEX_API_KEY');
    if (prev) process.env.VERDEX_API_KEY = prev;
  });
});
