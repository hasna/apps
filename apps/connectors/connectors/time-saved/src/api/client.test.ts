import { afterEach, describe, expect, test } from 'bun:test';
import { Connector } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  init?: RequestInit;
}

function installFetchMock(): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    recorded.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      init,
    });
    return Response.json({ ok: true });
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TimeSaved API client', () => {
  test('listReports sends Bearer auth to /reports', async () => {
    const recorded = installFetchMock();
    const client = new Connector({ apiKey: 'time-saved-key' });

    await client.reports.list();

    expect(recorded[0].url).toBe('https://api.time-saved.com/v1/reports');
    expect(new Headers(recorded[0].init?.headers).get('Authorization')).toBe('Bearer time-saved-key');
  });

  test('getReport encodes reportId in URL path', async () => {
    const recorded = installFetchMock();
    const client = new Connector({ apiKey: 'time-saved-key' });

    await client.reports.get('item-1');

    expect(recorded[0].url).toBe('https://api.time-saved.com/v1/reports/item-1');
    expect(new Headers(recorded[0].init?.headers).get('Authorization')).toBe('Bearer time-saved-key');
  });

  test('respects custom base URL override', async () => {
    const recorded = installFetchMock();
    const client = new Connector({
      apiKey: 'key',
      baseUrl: 'https://custom.example.com/v2',
    });

    await client.reports.list();

    expect(recorded[0].url).toBe('https://custom.example.com/v2/reports');
  });

  test('requires API key', () => {
    expect(() => new Connector({})).toThrow('API key is required');
  });
});
