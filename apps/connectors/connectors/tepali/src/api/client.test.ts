import { afterEach, describe, expect, test } from 'bun:test';
import { ConnectorClient, DEFAULT_BASE_URL } from './client';
import { Tepali } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(status = 200, json: unknown = {}) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers, body: init?.body });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as unknown as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Tepali ConnectorClient transport', () => {
  test('requires an API key', () => {
    expect(() => new ConnectorClient({})).toThrow('API key is required');
  });

  test('defaults to the public Tepali base URL', () => {
    const client = new ConnectorClient({ apiKey: 'k' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
    expect(client.buildUrl('/patients')).toBe('https://api.tepali.com/v1/patients');
  });

  test('honours a configurable base URL and trims trailing slashes', () => {
    const client = new ConnectorClient({ apiKey: 'k', baseUrl: 'https://staging.tepali.com/v2/' });
    expect(client.getBaseUrl()).toBe('https://staging.tepali.com/v2');
    expect(client.buildUrl('patients')).toBe('https://staging.tepali.com/v2/patients');
  });

  test('buildUrl appends defined query params and skips empties', () => {
    const client = new ConnectorClient({ apiKey: 'k' });
    const url = client.buildUrl('/patients', { page: 2, per_page: 25, status: '', q: undefined });
    expect(url).toBe('https://api.tepali.com/v1/patients?page=2&per_page=25');
  });

  test('sends a Bearer Authorization header', async () => {
    const recorded = installFetch(200, { data: [] });
    const client = new ConnectorClient({ apiKey: 'secret-key' });
    await client.get('/patients');
    expect(recorded[0].headers['Authorization']).toBe('Bearer secret-key');
    expect(recorded[0].headers['Accept']).toBe('application/json');
  });

  test('POST serialises the JSON body and sets Content-Type', async () => {
    const recorded = installFetch(200, { id: 'appt_1' });
    const tepali = new Tepali({ apiKey: 'k' });
    await tepali.appointments.create({ patient_id: 'pat_1', starts_at: '2026-07-10T15:00:00Z' });
    const call = recorded[0];
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://api.tepali.com/v1/appointments');
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(call.body as string)).toEqual({ patient_id: 'pat_1', starts_at: '2026-07-10T15:00:00Z' });
  });

  test('throws a ConnectorApiError with the parsed message on 4xx', async () => {
    installFetch(404, { message: 'Patient not found' });
    const client = new ConnectorClient({ apiKey: 'k' });
    await expect(client.get('/patients/missing')).rejects.toThrow('Patient not found');
  });

  test('raw() passes through arbitrary path and method', async () => {
    const recorded = installFetch(200, { ok: true });
    const tepali = new Tepali({ apiKey: 'k' });
    await tepali.raw('/reports/revenue', { method: 'GET', params: { month: '2026-07' } });
    expect(recorded[0].url).toBe('https://api.tepali.com/v1/reports/revenue?month=2026-07');
    expect(recorded[0].method).toBe('GET');
  });

  test('getApiKeyPreview masks the key', () => {
    const client = new ConnectorClient({ apiKey: 'abcdef1234567890' });
    expect(client.getApiKeyPreview()).toBe('abcdef...7890');
  });
});
