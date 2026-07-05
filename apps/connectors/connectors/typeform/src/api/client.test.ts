import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TypeformClient, encodePathSegment, appendQuery } from './client';
import { TypeformApiError } from '../types';

describe('TypeformClient', () => {
  const mockConfig = {
    apiToken: 'tfp_test_token_12345',
    baseUrl: 'https://api.typeform.com',
  };

  describe('encodePathSegment', () => {
    test('encodes special characters in path segments', () => {
      expect(encodePathSegment('form/id test')).toBe('form%2Fid%20test');
    });
  });

  describe('appendQuery', () => {
    test('appends page_size query param', () => {
      const path = appendQuery('/forms', { page_size: 25, page: 1 });
      expect(path).toContain('page_size=25');
      expect(path).toContain('page=1');
    });

    test('joins array values with commas', () => {
      const path = appendQuery('/forms/abc/responses', { included_tokens: ['tok1', 'tok2'] });
      expect(path).toContain('included_tokens=tok1%2Ctok2');
    });

    test('omits undefined values', () => {
      const path = appendQuery('/forms', { page: 1, search: undefined });
      expect(path).toContain('page=1');
      expect(path).not.toContain('search');
    });
  });

  describe('constructor', () => {
    test('throws when api token is missing', () => {
      expect(() => new TypeformClient({ apiToken: '' })).toThrow('Typeform API token is required');
    });

    test('creates client with valid config', () => {
      const client = new TypeformClient(mockConfig);
      expect(client).toBeInstanceOf(TypeformClient);
    });
  });

  describe('request', () => {
    let client: TypeformClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new TypeformClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('sends Bearer authorization header', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ items: [] })),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.get('/forms');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
      expect(call[1].headers.Authorization).toBe('Bearer tfp_test_token_12345');
    });

    test('encodes form id in path', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ id: 'abc' })),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.get(`/forms/${encodePathSegment('form/with/slash')}`);

      const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(call[0]).toContain('form%2Fwith%2Fslash');
    });

    test('throws TypeformApiError on failed response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: () => Promise.resolve(JSON.stringify({ description: 'Form not found' })),
        } as Response),
      ) as unknown as typeof fetch;

      await expect(client.get('/forms/missing')).rejects.toThrow(TypeformApiError);
    });

    test('handles 204 No Content', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          text: () => Promise.resolve(''),
        } as Response),
      ) as unknown as typeof fetch;

      const result = await client.delete('/forms/abc');
      expect(result).toEqual({});
    });
  });
});
