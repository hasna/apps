import { afterEach, describe, expect, test } from 'bun:test';
import { ZibraLabs } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ ok: true });
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

function authHeader(headers: Record<string, string>): string | undefined {
  return headers.authorization;
}

describe('ZibraLabsClient', () => {
  test('listClusters sends Bearer auth and query params', async () => {
    const recorded = installFetch();
    const client = new ZibraLabs({ apiKey: 'zibra-key' });
    await client.listClusters({ region: 'ny4' });
    expect(recorded[0].url).toBe('https://api.zibralabs.com/v1/clusters?region=ny4');
    expect(recorded[0].method).toBe('GET');
    expect(authHeader(recorded[0].headers)).toBe('Bearer zibra-key');
  });

  test('getCluster URL-encodes cluster id', async () => {
    const recorded = installFetch();
    const client = new ZibraLabs({ apiKey: 'zibra-key' });
    await client.getCluster('cluster 1');
    expect(recorded[0].url).toBe('https://api.zibralabs.com/v1/clusters/cluster%201');
  });

  test('submitBacktest posts JSON body', async () => {
    const recorded = installFetch();
    const client = new ZibraLabs({ apiKey: 'zibra-key' });
    await client.submitBacktest({ strategy_ref: 's3://strategies/mean-reversion.py' });
    expect(recorded[0].url).toBe('https://api.zibralabs.com/v1/backtests');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({ strategy_ref: 's3://strategies/mean-reversion.py' });
  });

  test('cancelBacktest posts to cancel endpoint', async () => {
    const recorded = installFetch();
    const client = new ZibraLabs({ apiKey: 'zibra-key' });
    await client.cancelBacktest('job 1', { reason: 'risk limit' });
    expect(recorded[0].url).toBe('https://api.zibralabs.com/v1/backtests/job%201/cancel');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({ reason: 'risk limit' });
  });

  test('listDatasets supports asset_class query', async () => {
    const recorded = installFetch();
    const client = new ZibraLabs({ apiKey: 'zibra-key' });
    await client.listDatasets({ asset_class: 'equities' });
    expect(recorded[0].url).toBe('https://api.zibralabs.com/v1/datasets?asset_class=equities');
  });

  test('rawRequest honors custom path and method', async () => {
    const recorded = installFetch();
    const client = new ZibraLabs({ apiKey: 'zibra-key' });
    await client.rawRequest({ path: '/custom/jobs', method: 'POST', body: { dry_run: true } });
    expect(recorded[0].url).toBe('https://api.zibralabs.com/v1/custom/jobs');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({ dry_run: true });
  });
});
