import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { SpotifyAdsClient, DEFAULT_BASE_URL } from './client';
import { SpotifyAdsApiError } from '../types';

describe('SpotifyAdsClient', () => {
  const mockConfig = {
    accessToken: 'test-access-token-abcdef',
    baseUrl: DEFAULT_BASE_URL,
  };

  describe('constructor', () => {
    test('throws when access token is missing', () => {
      expect(() => new SpotifyAdsClient({ accessToken: '' })).toThrow('Access token is required');
    });

    test('creates client with valid config', () => {
      const client = new SpotifyAdsClient(mockConfig);
      expect(client).toBeInstanceOf(SpotifyAdsClient);
      expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
    });

    test('uses custom base URL when provided', () => {
      const client = new SpotifyAdsClient({
        accessToken: 'token',
        baseUrl: 'https://example.test/ads/v3/',
      });
      expect(client.getBaseUrl()).toBe('https://example.test/ads/v3');
    });
  });

  describe('getAccessTokenPreview', () => {
    test('masks long tokens', () => {
      const client = new SpotifyAdsClient(mockConfig);
      expect(client.getAccessTokenPreview()).toBe('test-a...cdef');
    });
  });

  describe('request', () => {
    let client: SpotifyAdsClient;
    let originalFetch: typeof global.fetch;
    let fetchMock: ReturnType<typeof mock>;

    beforeEach(() => {
      client = new SpotifyAdsClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() sends Bearer auth and v3 campaign list path', async () => {
      const mockResponse = { campaigns: [{ id: 'camp-1', name: 'Test' }] };
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await client.get('/ad_accounts/acct-1/campaigns');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(`${DEFAULT_BASE_URL}/ad_accounts/acct-1/campaigns`);
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer test-access-token-abcdef');
      expect(result).toEqual(mockResponse);
    });

    test('get() builds campaign get path', async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"id":"camp-1"}'),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.get('ad_accounts/acct-1/campaigns/camp-1');

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(`${DEFAULT_BASE_URL}/ad_accounts/acct-1/campaigns/camp-1`);
    });

    test('get() appends query parameters', async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"campaigns":[]}'),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.get('/ad_accounts/acct-1/campaigns', { offset: 0, page_size: 25 });

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('offset=0');
      expect(url).toContain('page_size=25');
    });

    test('throws SpotifyAdsApiError on non-retryable failure', async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"message":"bad request"}'),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(client.get('/businesses')).rejects.toBeInstanceOf(SpotifyAdsApiError);
    });
  });
});
