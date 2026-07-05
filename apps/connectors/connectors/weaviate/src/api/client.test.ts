import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { WeaviateClient } from './client';
import { WeaviateApiError } from '../types';

describe('WeaviateClient', () => {
  const mockConfig = {
    host: 'https://example.com',
    apiKey: 'weaviate-token',
  };

  describe('constructor', () => {
    test('throws error when host is missing', () => {
      expect(() => new WeaviateClient({ host: '' })).toThrow('Weaviate host is required');
    });

    test('strips trailing slash from host', () => {
      const client = new WeaviateClient({ host: 'https://example.com/' });
      expect(client.getBaseUrl()).toBe('https://example.com/v1');
    });
  });

  describe('request', () => {
    let client: WeaviateClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new WeaviateClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('GET /schema uses correct URL and Bearer header', async () => {
      const mockResponse = { classes: [] };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      ) as unknown as typeof fetch;

      const result = await client.request('/schema');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const fetchMock = global.fetch as unknown as ReturnType<typeof mock>;
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://example.com/v1/schema');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer weaviate-token');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(result).toEqual(mockResponse);
    });

    test('omits Authorization header when apiKey is not set', async () => {
      const clientNoKey = new WeaviateClient({ host: 'https://example.com' });
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve('{}'),
        } as Response),
      ) as unknown as typeof fetch;

      await clientNoKey.request('/schema');

      const fetchMock = global.fetch as unknown as ReturnType<typeof mock>;
      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers.Authorization).toBeUndefined();
    });

    test('throws WeaviateApiError on non-2xx response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          text: () => Promise.resolve('upstream error'),
        } as Response),
      ) as unknown as typeof fetch;

      try {
        await client.request('/schema');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(WeaviateApiError);
        expect((err as WeaviateApiError).statusCode).toBe(502);
        expect((err as WeaviateApiError).message).toMatch(/Weaviate: 502/);
      }
    });

    test('handles 204 No Content', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          text: () => Promise.resolve(''),
        } as Response),
      ) as unknown as typeof fetch;

      const result = await client.request('/objects/Article/abc', { method: 'DELETE' });
      expect(result).toEqual({});
    });
  });
});
