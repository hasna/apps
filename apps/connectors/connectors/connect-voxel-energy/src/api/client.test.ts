import { afterEach, describe, expect, test } from 'bun:test';
import { VoxelEnergyClient, encodePathSegment, DEFAULT_BASE_URL } from './client';
import { VoxelEnergy } from './index';
import { VoxelEnergyApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => { result[key.toLowerCase()] = value; });
    return result;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) result[key.toLowerCase()] = value;
    return result;
  }
  for (const [key, value] of Object.entries(headers)) result[key.toLowerCase()] = value;
  return result;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => Response | Promise<Response>
): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = headersToRecord(init?.headers);
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { /* keep string */ }
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers, body });
    return handler(url, init, recorded);
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

describe('VoxelEnergyClient', () => {
  const mockConfig = {
    apiKey: 'voxel-energy-key',
    baseUrl: 'https://api.voxelenergy.com/v1',
  };

  describe('constructor', () => {
    test('throws error when apiKey is missing', () => {
      expect(() => new VoxelEnergyClient({ apiKey: '' })).toThrow('API key is required');
    });

    test('uses default base URL when not provided', () => {
      const client = new VoxelEnergyClient({ apiKey: 'test-key' });
      expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
    });
  });

  describe('encodePathSegment', () => {
    test('encodes spaces in path segments', () => {
      expect(encodePathSegment('site 1')).toBe('site%201');
      expect(encodePathSegment('res 1')).toBe('res%201');
    });
  });

  describe('request methods', () => {
    test('get() makes GET request with Bearer authorization', async () => {
      const recorded = installFetch(() => jsonResponse({ sites: [] }));
      const client = new VoxelEnergyClient(mockConfig);
      const result = await client.get('/sites');

      expect(recorded).toHaveLength(1);
      expect(recorded[0].url).toBe('https://api.voxelenergy.com/v1/sites');
      expect(recorded[0].method).toBe('GET');
      expect(recorded[0].headers.authorization).toBe('Bearer voxel-energy-key');
      expect(result).toEqual({ sites: [] });
    });

    test('get() appends query parameters', async () => {
      const recorded = installFetch(() => jsonResponse({}));
      const client = new VoxelEnergyClient(mockConfig);
      await client.get('/sites', { region: 'us-west' });

      expect(recorded[0].url).toBe('https://api.voxelenergy.com/v1/sites?region=us-west');
    });

    test('post() makes POST request with JSON body', async () => {
      const recorded = installFetch(() => jsonResponse({ id: 'res-1' }, 201));
      const client = new VoxelEnergyClient(mockConfig);
      const body = { siteId: 'site 1', gpuCount: 256 };
      const result = await client.post('/reservations', body);

      expect(recorded[0].url).toBe('https://api.voxelenergy.com/v1/reservations');
      expect(recorded[0].method).toBe('POST');
      expect(recorded[0].headers['content-type']).toBe('application/json');
      expect(recorded[0].body).toEqual(body);
      expect(result).toEqual({ id: 'res-1' });
    });

    test('throws VoxelEnergyApiError on error response', async () => {
      installFetch(() => jsonResponse({ message: 'Not found' }, 404));
      const client = new VoxelEnergyClient(mockConfig);
      await expect(client.get('/sites/missing')).rejects.toThrow(VoxelEnergyApiError);
    });
  });
});

describe('VoxelEnergy', () => {
  test('encodes site and reservation IDs in paths', async () => {
    const recorded = installFetch(() => jsonResponse({}));
    const api = new VoxelEnergy({ apiKey: 'voxel-energy-key' });

    await api.getSite('site 1');
    await api.getSitePowerProfile('site 1');
    await api.getSiteCapacity('site 1');
    await api.getReservation('res 1');

    expect(recorded.map(r => r.url)).toEqual([
      'https://api.voxelenergy.com/v1/sites/site%201',
      'https://api.voxelenergy.com/v1/sites/site%201/power-profile',
      'https://api.voxelenergy.com/v1/sites/site%201/capacity',
      'https://api.voxelenergy.com/v1/reservations/res%201',
    ]);
  });

  test('list endpoints pass query parameters', async () => {
    const recorded = installFetch(() => jsonResponse({}));
    const api = new VoxelEnergy({ apiKey: 'voxel-energy-key' });

    await api.listSites({ region: 'us-west' });
    await api.listReservations({ status: 'active' });

    expect(recorded[0].url).toBe('https://api.voxelenergy.com/v1/sites?region=us-west');
    expect(recorded[1].url).toBe('https://api.voxelenergy.com/v1/reservations?status=active');
  });
});
