import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TrustpilotBusinessClient } from './client';
import { TrustpilotBusinessApiError } from '../types';

type FetchMock = ReturnType<typeof mock>;

describe('TrustpilotBusinessClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    apiSecret: 'test-api-secret-67890',
    baseUrl: 'https://api.trustpilot.com/v1',
  };

  describe('constructor', () => {
    test('throws error when apiKey is missing', () => {
      expect(() => new TrustpilotBusinessClient({ apiKey: '' })).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new TrustpilotBusinessClient(mockConfig);
      expect(client).toBeInstanceOf(TrustpilotBusinessClient);
    });
  });

  describe('getApiKeyPreview', () => {
    test('returns masked key for long keys', () => {
      const client = new TrustpilotBusinessClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('test-a...2345');
    });
  });

  describe('request methods', () => {
    let client: TrustpilotBusinessClient;
    let originalFetch: typeof global.fetch;
    let fetchMock: FetchMock;

    beforeEach(() => {
      client = new TrustpilotBusinessClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() sends apikey header on public review requests', async () => {
      const mockResponse = { id: 'review-1', stars: 5 };
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await client.get('/reviews/review-1');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.trustpilot.com/v1/reviews/review-1');
      expect(options.method).toBe('GET');
      expect(options.headers.apikey).toBe('test-api-key-12345');
      expect(options.headers.Authorization).toBeUndefined();
      expect(result).toEqual(mockResponse);
    });

    test('get() uses Bearer token for private routes when secret is configured', async () => {
      fetchMock = mock((url: string | URL | Request) => {
        const href = typeof url === 'string' ? url : url.toString();
        if (href.includes('/oauth/oauth-business-users-for-applications/accesstoken')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ access_token: 'access-token-abc', expires_in: 3600 }),
            text: () => Promise.resolve(JSON.stringify({ access_token: 'access-token-abc', expires_in: 3600 })),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ reviews: [] })),
        } as Response);
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.get('/private/business-units/bu-1/reviews', { page: 1 }, { privateAuth: true });

      expect(fetchMock).toHaveBeenCalledTimes(2);

      const tokenCall = fetchMock.mock.calls[0];
      expect(tokenCall[0]).toBe('https://api.trustpilot.com/v1/oauth/oauth-business-users-for-applications/accesstoken');
      expect(tokenCall[1].headers.Authorization).toBe(
        `Basic ${Buffer.from('test-api-key-12345:test-api-secret-67890').toString('base64')}`,
      );

      const reviewCall = fetchMock.mock.calls[1];
      expect(reviewCall[0]).toBe('https://api.trustpilot.com/v1/private/business-units/bu-1/reviews?page=1');
      expect(reviewCall[1].headers.Authorization).toBe('Bearer access-token-abc');
      expect(reviewCall[1].headers.apikey).toBeUndefined();
    });

    test('throws TrustpilotBusinessApiError on failed responses', async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Not found' })),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(client.get('/reviews/missing')).rejects.toThrow(TrustpilotBusinessApiError);
    });

    test('requires api secret for private routes', async () => {
      const publicClient = new TrustpilotBusinessClient({ apiKey: 'key-only' });

      await expect(
        publicClient.get('/private/reviews/review-1', undefined, { privateAuth: true }),
      ).rejects.toThrow('API secret is required for private API routes');
    });
  });
});
