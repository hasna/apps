import { afterEach, describe, expect, test } from 'bun:test';
import { Solcast } from './index';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('SolcastClient', () => {
  test('forecastRooftopPvPower builds URL with api_key, lat, lon, capacity', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async text() {
          return JSON.stringify({ forecasts: [] });
        },
      } as Response;
    }) as typeof fetch;

    const solcast = new Solcast({ apiKey: 'solcast-key' });
    await solcast.api.forecastRooftopPvPower({
      latitude: -33.9,
      longitude: 151.2,
      capacity: 5,
    });

    const url = new URL(capturedUrl);
    expect(url.origin + url.pathname).toBe('https://api.solcast.com.au/data/forecast/rooftop_pv_power');
    expect(url.searchParams.get('latitude')).toBe('-33.9');
    expect(url.searchParams.get('longitude')).toBe('151.2');
    expect(url.searchParams.get('capacity')).toBe('5');
    expect(url.searchParams.get('api_key')).toBe('solcast-key');
    expect(url.searchParams.get('format')).toBe('json');
  });

  test('uses SOLCAST_BASE_URL override from config', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async text() {
          return JSON.stringify({ forecasts: [] });
        },
      } as Response;
    }) as typeof fetch;

    const solcast = new Solcast({ apiKey: 'key', baseUrl: 'https://custom.example.com' });
    await solcast.api.liveRooftopPvPower({ latitude: 1, longitude: 2, capacity: 3 });

    expect(capturedUrl.startsWith('https://custom.example.com/data/live/rooftop_pv_power')).toBe(true);
  });

  test('rooftopSiteForecasts encodes site id in path', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async text() {
          return JSON.stringify({ forecasts: [] });
        },
      } as Response;
    }) as typeof fetch;

    const solcast = new Solcast({ apiKey: 'key' });
    await solcast.api.rooftopSiteForecasts('site-123');

    expect(capturedUrl).toContain('/rooftop_sites/site-123/forecasts');
    expect(capturedUrl).toContain('api_key=key');
  });

  test('throws SolcastApiError on HTTP error', async () => {
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        async text() {
          return JSON.stringify({ response_status: { message: 'Invalid API key' } });
        },
      } as Response;
    }) as unknown as typeof fetch;

    const solcast = new Solcast({ apiKey: 'bad' });
    await expect(
      solcast.api.forecastRooftopPvPower({ latitude: 0, longitude: 0, capacity: 1 }),
    ).rejects.toThrow('Invalid API key');
  });

  test('requires api key', () => {
    expect(() => new Solcast({ apiKey: '' })).toThrow('API key is required');
  });
});
