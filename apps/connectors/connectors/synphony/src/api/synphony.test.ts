import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Connector } from './index';
import { ConnectorApiError } from '../types';

interface Captured {
  url: string;
  init: RequestInit;
}

const originalFetch = globalThis.fetch;

function mockFetch(status: number, body: unknown): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

describe('SynphonyApi', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('listFarms hits GET /farms with a Bearer header', async () => {
    const calls = mockFetch(200, [{ id: 'farm_1' }]);
    const connector = new Connector({ apiKey: 'secret-key' });

    const result = await connector.synphony.listFarms();

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('https://api.synphony.ai/v1/farms');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-key');
    expect(result).toEqual([{ id: 'farm_1' }]);
  });

  test('getFarm encodes the path segment', async () => {
    const calls = mockFetch(200, { id: 'a/b' });
    const connector = new Connector({ apiKey: 'k' });

    await connector.synphony.getFarm('a/b');

    expect(calls[0].url).toBe('https://api.synphony.ai/v1/farms/a%2Fb');
  });

  test('getTelemetry appends query parameters', async () => {
    const calls = mockFetch(200, {});
    const connector = new Connector({ apiKey: 'k' });

    await connector.synphony.getTelemetry('robot_9', { window: '1h' });

    expect(calls[0].url).toBe('https://api.synphony.ai/v1/robots/robot_9/telemetry?window=1h');
  });

  test('respects a custom base URL', async () => {
    const calls = mockFetch(200, []);
    const connector = new Connector({ apiKey: 'k', baseUrl: 'https://staging.example.com/v2/' });

    await connector.synphony.listRobots();

    expect(calls[0].url).toBe('https://staging.example.com/v2/robots');
  });

  test('rawRequest allows arbitrary path and method', async () => {
    const calls = mockFetch(200, { ok: true });
    const connector = new Connector({ apiKey: 'k' });

    await connector.synphony.rawRequest({ path: '/custom', method: 'POST', body: { a: 1 } });

    expect(calls[0].url).toBe('https://api.synphony.ai/v1/custom');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBe(JSON.stringify({ a: 1 }));
  });

  test('throws ConnectorApiError on 4xx', async () => {
    mockFetch(404, { message: 'not found' });
    const connector = new Connector({ apiKey: 'k' });

    await expect(connector.synphony.getFarm('missing')).rejects.toBeInstanceOf(ConnectorApiError);
  });

  test('requires an API key', () => {
    expect(() => new Connector({} as { apiKey?: string })).toThrow('Synphony API key is required');
  });
});
