import { afterEach, describe, expect, test } from 'bun:test';
import { Connector, ConnectorClient, DEFAULT_BASE_URL } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: RecordedRequest) => unknown) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const entry: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);
    const json = handler(entry);
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

describe('Wordfence ConnectorClient', () => {
  test('requires API key', () => {
    expect(() => new ConnectorClient({})).toThrow('Wordfence API key is required');
  });

  test('uses Bearer auth and default base URL', async () => {
    const recorded = installFetch(() => ({ scans: [] }));
    const client = new Connector({ apiKey: 'wf-test-key' });
    await client.scans.list();
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/scans`);
    expect(recorded[0].headers.authorization).toBe('Bearer wf-test-key');
  });

  test('listScans hits GET /scans with query params', async () => {
    const recorded = installFetch(() => ({ scans: [{ id: 'scan-1' }] }));
    const client = new Connector({ apiKey: 'wf-test-key' });
    await client.scans.list({ limit: 10, status: 'complete' });
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].url).toContain('/scans');
    expect(recorded[0].url).toContain('limit=10');
    expect(recorded[0].url).toContain('status=complete');
  });

  test('createScan posts to /scans', async () => {
    const recorded = installFetch(() => ({ id: 'scan-new' }));
    const client = new Connector({ apiKey: 'wf-test-key' });
    await client.scans.create({ siteId: 'site-1', type: 'full' });
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/scans`);
    expect(recorded[0].body).toContain('"siteId":"site-1"');
  });

  test('getScan encodes scan ID in path', async () => {
    const recorded = installFetch(() => ({ id: 'scan/special' }));
    const client = new Connector({ apiKey: 'wf-test-key' });
    await client.scans.get('scan/special');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/scans/scan%2Fspecial`);
  });

  test('listEvents hits GET /events', async () => {
    const recorded = installFetch(() => ({ events: [] }));
    const client = new Connector({ apiKey: 'wf-test-key' });
    await client.events.list({ type: 'login', since: '2026-01-01' });
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].url).toContain('/events');
    expect(recorded[0].url).toContain('type=login');
    expect(recorded[0].url).toContain('since=2026-01-01');
  });

  test('search posts query to /search', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const client = new Connector({ apiKey: 'wf-test-key' });
    await client.search.search({ query: 'malware', type: 'issue' });
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/search`);
    expect(recorded[0].body).toContain('"query":"malware"');
  });

  test('respects custom base URL', async () => {
    const recorded = installFetch(() => ({}));
    const client = new Connector({ apiKey: 'wf-test-key', baseUrl: 'https://custom.example/v2' });
    await client.events.list();
    expect(recorded[0].url).toStartWith('https://custom.example/v2/events');
  });
});
