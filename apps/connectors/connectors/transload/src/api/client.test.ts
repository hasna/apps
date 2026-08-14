import { afterEach, describe, expect, test } from 'bun:test';
import { Connector, encodePathSegment } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: Recorded) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) {
        headers[k.toLowerCase()] = v;
      }
    }
    const entry: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: init?.body as string | undefined,
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

describe('Transload API client', () => {
  test('encodePathSegment encodes spaces and special characters', () => {
    expect(encodePathSegment('ship 123')).toBe('ship%20123');
    expect(encodePathSegment('a/b')).toBe('a%2Fb');
  });

  test('requires API key', () => {
    expect(() => new Connector({})).toThrow('API key or token is required');
  });

  test('listSites sends Bearer auth and hits /sites', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toContain('/sites');
      expect(entry.headers.authorization).toBe('Bearer test-key');
      return { sites: [] };
    });
    const client = new Connector({ apiKey: 'test-key' });
    await client.sites.list();
    expect(recorded).toHaveLength(1);
    expect(recorded[0].method).toBe('GET');
  });

  test('getMeasurement hits /shipments/{id}/measurement with encoded ID', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toContain('/shipments/ship%20123/measurement');
      expect(entry.headers.authorization).toBe('Bearer test-key');
      return { measurement: { length: 10 } };
    });
    const client = new Connector({ apiKey: 'test-key' });
    await client.shipments.getMeasurement('ship 123');
    expect(recorded).toHaveLength(1);
  });

  test('syncMeasurements POSTs to /measurements/sync', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toContain('/measurements/sync');
      expect(entry.method).toBe('POST');
      expect(entry.headers.authorization).toBe('Bearer test-key');
      return { synced: 1 };
    });
    const client = new Connector({ apiKey: 'test-key' });
    await client.measurements.sync({ site_id: 'site-1' });
    expect(recorded).toHaveLength(1);
    expect(JSON.parse(recorded[0].body!)).toEqual({ site_id: 'site-1' });
  });

  test('rawRequest supports custom path and method', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toContain('/custom/path');
      expect(entry.method).toBe('POST');
      return { ok: true };
    });
    const client = new Connector({ apiKey: 'test-key' });
    await client.rawRequest('/custom/path', { method: 'POST', body: { foo: 'bar' } });
    expect(recorded).toHaveLength(1);
  });
});
