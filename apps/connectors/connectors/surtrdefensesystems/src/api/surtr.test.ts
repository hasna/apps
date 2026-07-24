import { afterEach, describe, expect, test } from 'bun:test';
import { Surtr } from './index';
import { DEFAULT_BASE_URL } from './client';
import { SurtrApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => { status?: number; json?: unknown } = () => ({}),
): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    const rawHeaders = (init?.headers || {}) as Record<string, string>;
    for (const [k, v] of Object.entries(rawHeaders)) headers[k] = v;
    recorded.push({ url, method: init?.method ?? 'GET', headers, body: init?.body });
    const { status = 200, json = {} } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
      async text() {
        return JSON.stringify(json);
      },
    } as unknown as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Surtr client', () => {
  test('requires an API key', () => {
    expect(() => new Surtr({ apiKey: '' })).toThrow('API key is required');
  });

  test('listSensors builds GET /sensors against the default base URL', async () => {
    const recorded = installFetch(() => ({ json: { data: [] } }));
    const surtr = new Surtr({ apiKey: 'test-key' });
    await surtr.listSensors();

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/sensors`);
    expect(recorded[0].method).toBe('GET');
  });

  test('sends Authorization: Bearer <key> header', async () => {
    const recorded = installFetch(() => ({ json: { data: [] } }));
    const surtr = new Surtr({ apiKey: 'secret-token' });
    await surtr.listSensors();

    expect(recorded[0].headers['Authorization']).toBe('Bearer secret-token');
  });

  test('listSensors forwards filters as query params', async () => {
    const recorded = installFetch(() => ({ json: { data: [] } }));
    const surtr = new Surtr({ apiKey: 'k' });
    await surtr.listSensors({ status: 'online', type: 'radar', limit: 25 });

    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe('/v1/sensors');
    expect(url.searchParams.get('status')).toBe('online');
    expect(url.searchParams.get('type')).toBe('radar');
    expect(url.searchParams.get('limit')).toBe('25');
  });

  test('getSensor builds GET /sensors/{id} with encoded id', async () => {
    const recorded = installFetch(() => ({ json: { id: 'a b' } }));
    const surtr = new Surtr({ apiKey: 'k' });
    await surtr.getSensor('a b');

    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/sensors/a%20b`);
  });

  test('getSituationPicture builds GET /situation', async () => {
    const recorded = installFetch(() => ({ json: { threat_count: 0 } }));
    const surtr = new Surtr({ apiKey: 'k' });
    await surtr.getSituationPicture();

    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/situation`);
    expect(recorded[0].method).toBe('GET');
  });

  test('createEngagementRecommendation POSTs to /engagements/recommendations with JSON body', async () => {
    const recorded = installFetch(() => ({ json: { threat_id: 't1' } }));
    const surtr = new Surtr({ apiKey: 'k' });
    await surtr.createEngagementRecommendation({ threat_id: 't1', method: 'rf-jam' });

    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/engagements/recommendations`);
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(recorded[0].body as string)).toEqual({ threat_id: 't1', method: 'rf-jam' });
  });

  test('honours a custom base URL and trims trailing slashes', async () => {
    const recorded = installFetch(() => ({ json: { data: [] } }));
    const surtr = new Surtr({ apiKey: 'k', baseUrl: 'https://surtr.internal.example/api/v2/' });
    await surtr.listThreats();

    expect(recorded[0].url).toBe('https://surtr.internal.example/api/v2/threats');
  });

  test('throws SurtrApiError on non-2xx responses', async () => {
    installFetch(() => ({ status: 403, json: { error: { message: 'forbidden' } } }));
    const surtr = new Surtr({ apiKey: 'k' });

    await expect(surtr.getThreat('t1')).rejects.toBeInstanceOf(SurtrApiError);
  });
});
