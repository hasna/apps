import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { WeezeventClient } from './client';
import { WeezeventApiError } from '../types';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe('WeezeventClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key',
    accessToken: 'test-access-token',
    baseUrl: 'https://api.weezevent.com',
  };

  describe('constructor', () => {
    test('throws when apiKey is missing', () => {
      expect(() => new WeezeventClient({ apiKey: '', accessToken: 'token' })).toThrow(
        'Weezevent apiKey and accessToken are required',
      );
    });

    test('throws when accessToken is missing', () => {
      expect(() => new WeezeventClient({ apiKey: 'key', accessToken: '' })).toThrow(
        'Weezevent apiKey and accessToken are required',
      );
    });

    test('creates client with valid config', () => {
      const client = new WeezeventClient(mockConfig);
      expect(client).toBeInstanceOf(WeezeventClient);
    });
  });

  describe('listEvents', () => {
    let client: WeezeventClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new WeezeventClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('GET /events includes api_key, access_token, and include_closed passthrough', async () => {
      const fetchMock = mock(() => Promise.resolve(jsonResponse({ events: [] })));
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.get('/events', { include_closed: true });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toContain('https://api.weezevent.com/events');
      expect(url).toContain('api_key=test-api-key');
      expect(url).toContain('access_token=test-access-token');
      expect(url).toContain('include_closed=true');
      expect(options.headers).toEqual({ Accept: 'application/json' });
    });

    test('appends array params with bracket notation', async () => {
      const fetchMock = mock(() => Promise.resolve(jsonResponse({ dates: [] })));
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.get('/dates', { id_event: [11435, 10473] });

      const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toContain('id_event%5B%5D=11435');
      expect(url).toContain('id_event%5B%5D=10473');
    });

    test('throws WeezeventApiError on non-retryable failure', async () => {
      global.fetch = mock(() =>
        Promise.resolve(jsonResponse({ message: 'Invalid credentials' }, 401)),
      ) as unknown as typeof fetch;

      await expect(client.get('/events')).rejects.toBeInstanceOf(WeezeventApiError);
    });
  });
});
