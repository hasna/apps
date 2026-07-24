import { afterEach, describe, expect, test } from 'bun:test';
import { UPSClient, encodePathSegment } from './client';
import { UPS } from './index';
import { UPSApiError } from '../types';

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
    const rawHeaders = init?.headers;
    const headers: Record<string, string> =
      rawHeaders instanceof Headers
        ? Object.fromEntries(rawHeaders.entries())
        : Array.isArray(rawHeaders)
          ? Object.fromEntries(rawHeaders)
          : { ...(rawHeaders as Record<string, string> | undefined) };
    const entry: Recorded = {
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

describe('encodePathSegment', () => {
  test('encodes special characters in shipment IDs', () => {
    expect(encodePathSegment('ship/123')).toBe('ship%2F123');
    expect(encodePathSegment('id with spaces')).toBe('id%20with%20spaces');
  });
});

describe('UPSClient', () => {
  const mockConfig = {
    apiKey: 'test-ups-token-12345',
    baseUrl: 'https://api.ups.com/v1',
  };

  test('throws when apiKey is missing', () => {
    expect(() => new UPSClient({ apiKey: '' })).toThrow('UPS apiKey is required');
  });

  test('get() sends Authorization Bearer header and correct URL', async () => {
    const recorded = installFetch(() => ({ shipments: [] }));
    const client = new UPSClient(mockConfig);
    const result = await client.get<{ shipments: unknown[] }>('/shipments', { page: 1 });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.ups.com/v1/shipments?page=1');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.Authorization).toBe('Bearer test-ups-token-12345');
    expect(result).toEqual({ shipments: [] });
  });

  test('getShipment path encodes shipmentId', async () => {
    const recorded = installFetch(() => ({}));
    const ups = new UPS(mockConfig);
    await ups.getShipment('ship/123');
    expect(recorded[0].url).toBe('https://api.ups.com/v1/shipments/ship%2F123');
  });

  test('post() sends JSON body', async () => {
    const recorded = installFetch(() => ({ id: 's1' }));
    const client = new UPSClient(mockConfig);
    await client.post('/shipments', { trackingNumber: '1Z999' });

    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers['Content-Type']).toBe('application/json');
    expect(recorded[0].body).toBe(JSON.stringify({ trackingNumber: '1Z999' }));
  });

  test('throws UPSApiError on error response', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        async text() {
          return JSON.stringify({ message: 'Invalid token' });
        },
      }) as Response) as unknown as typeof fetch;

    const client = new UPSClient(mockConfig);
    await expect(client.get('/shipments')).rejects.toThrow(UPSApiError);
  });
});
