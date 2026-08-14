import { afterEach, describe, expect, test } from 'bun:test';
import { TomTom } from './index';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TomTom API client', () => {
  test('geocode builds expected URL with query param key', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ results: [] });
        },
      } as Response;
    }) as typeof fetch;

    const client = new TomTom({ apiKey: 'tomtom-key' });
    await client.geocode('Berlin', { limit: 3 });

    expect(capturedUrl).toBe(
      'https://api.tomtom.com/search/2/geocode/Berlin.json?key=tomtom-key&limit=3'
    );
  });

  test('geocode sends Accept application/json header', async () => {
    let capturedHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ results: [] });
        },
      } as Response;
    }) as typeof fetch;

    const client = new TomTom({ apiKey: 'tomtom-key' });
    await client.geocode('Paris');

    expect(capturedHeaders).toEqual({ Accept: 'application/json' });
  });

  test('reverseGeocode uses coordinate path segment', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ results: [] });
        },
      } as Response;
    }) as typeof fetch;

    const client = new TomTom({ apiKey: 'test-key' });
    await client.reverseGeocode(52.5, 13.4);

    expect(capturedUrl).toBe(
      'https://api.tomtom.com/search/2/reverseGeocode/52.5,13.4.json?key=test-key'
    );
  });

  test('calculateRoute builds routing URL with travelMode', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ routes: [] });
        },
      } as Response;
    }) as typeof fetch;

    const client = new TomTom({ apiKey: 'route-key' });
    await client.calculateRoute(52.5, 13.4, 48.1, 11.5, { travelMode: 'pedestrian' });

    expect(capturedUrl).toBe(
      'https://api.tomtom.com/routing/1/calculateRoute/52.5,13.4:48.1,11.5/json?key=route-key&travelMode=pedestrian'
    );
  });
});
