import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { SupadataClient } from './client';
import { SupadataApiError } from '../types';

describe('SupadataClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://api.supadata.ai/v1',
  };

  describe('constructor', () => {
    test('throws error when API key is missing', () => {
      expect(() => new SupadataClient({ apiKey: '' })).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new SupadataClient(mockConfig);
      expect(client).toBeInstanceOf(SupadataClient);
    });
  });

  describe('getApiKeyPreview', () => {
    test('returns masked key for long keys', () => {
      const client = new SupadataClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('test-a...2345');
    });

    test('returns *** for short keys', () => {
      const client = new SupadataClient({ ...mockConfig, apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
    });
  });

  describe('request', () => {
    let client: SupadataClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new SupadataClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() sends x-api-key header and correct path for web scrape', async () => {
      const mockResponse = { url: 'https://example.com', content: '# Hello' };
      let capturedUrl = '';
      let capturedHeaders: HeadersInit | undefined;

      global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedHeaders = init?.headers;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response;
      }) as typeof fetch;

      const result = await client.get('/web/scrape', { url: 'https://example.com' });

      expect(capturedUrl).toBe('https://api.supadata.ai/v1/web/scrape?url=https%3A%2F%2Fexample.com');
      expect(capturedHeaders).toMatchObject({ 'x-api-key': 'test-api-key-12345' });
      expect(result).toEqual(mockResponse);
    });

    test('throws SupadataApiError on failed response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Invalid API key' })),
        } as Response),
      ) as unknown as typeof fetch;

      await expect(client.get('/me')).rejects.toThrow(SupadataApiError);
    });
  });
});
