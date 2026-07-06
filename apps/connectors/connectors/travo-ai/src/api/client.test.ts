import { afterEach, describe, expect, test } from 'bun:test';
import { TravoAiClient } from './client';
import { TravoAiApiError } from '../types';

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
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => {
        headers[key] = value;
      });
    }
    const entry: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);
    const json = handler(entry);
    const body = JSON.stringify(json ?? {});
    return {
      ok: true,
      status: 200,
      async text() {
        return body;
      },
      async json() {
        return json ?? {};
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TravoAiClient', () => {
  test('throws when API key is missing', () => {
    expect(() => new TravoAiClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('listTrips sends Bearer auth and GET /trips', async () => {
    const recorded = installFetch((req) => {
      expect(req.headers.authorization).toBe('Bearer test-key');
      expect(req.method).toBe('GET');
      expect(req.url).toBe('https://api.travo.ai/v1/trips');
      return { trips: [{ id: 'trip-1' }] };
    });

    const client = new TravoAiClient({ apiKey: 'test-key' });
    const result = await client.listTrips();
    expect(result).toEqual({ trips: [{ id: 'trip-1' }] });
    expect(recorded).toHaveLength(1);
  });

  test('listTrips passes query parameters', async () => {
    const recorded = installFetch((req) => {
      expect(req.url).toBe('https://api.travo.ai/v1/trips?limit=5&status=active');
      return { trips: [] };
    });

    const client = new TravoAiClient({ apiKey: 'test-key' });
    await client.listTrips({ limit: 5, status: 'active' });
    expect(recorded).toHaveLength(1);
  });

  test('getTrip encodes trip ID in path', async () => {
    const recorded = installFetch((req) => {
      expect(req.url).toBe('https://api.travo.ai/v1/trips/trip%2F42');
      expect(req.method).toBe('GET');
      return { id: 'trip/42' };
    });

    const client = new TravoAiClient({ apiKey: 'test-key' });
    const trip = await client.getTrip('trip/42');
    expect(trip.id).toBe('trip/42');
    expect(recorded).toHaveLength(1);
  });

  test('createTrip POSTs JSON body to /trips', async () => {
    const recorded = installFetch((req) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('https://api.travo.ai/v1/trips');
      expect(req.body).toBe(JSON.stringify({ destination: 'Paris' }));
      return { id: 'new-trip' };
    });

    const client = new TravoAiClient({ apiKey: 'test-key' });
    const trip = await client.createTrip({ destination: 'Paris' });
    expect(trip.id).toBe('new-trip');
    expect(recorded).toHaveLength(1);
  });

  test('search POSTs to /search', async () => {
    const recorded = installFetch((req) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('https://api.travo.ai/v1/search');
      expect(req.body).toBe(JSON.stringify({ query: 'hotels in Tokyo' }));
      return { results: [] };
    });

    const client = new TravoAiClient({ apiKey: 'test-key' });
    await client.search({ query: 'hotels in Tokyo' });
    expect(recorded).toHaveLength(1);
  });

  test('uses custom base URL from config', async () => {
    const recorded = installFetch((req) => {
      expect(req.url).toBe('https://custom.example/v1/events');
      return { events: [] };
    });

    const client = new TravoAiClient({
      apiKey: 'test-key',
      baseUrl: 'https://custom.example/v1/',
    });
    await client.listEvents();
    expect(recorded).toHaveLength(1);
  });

  test('throws TravoAiApiError on non-OK responses', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      async text() {
        return JSON.stringify({ message: 'Unauthorized' });
      },
    })) as unknown as typeof fetch;

    const client = new TravoAiClient({ apiKey: 'bad-key' });
    await expect(client.listTrips()).rejects.toBeInstanceOf(TravoAiApiError);
  });
});
