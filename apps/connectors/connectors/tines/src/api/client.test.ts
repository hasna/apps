import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TinesClient, buildQuery } from './client';
import { TinesApiError } from '../types';

describe('TinesClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    tenantUrl: 'https://tenant.tines.com',
  };

  describe('constructor', () => {
    test('throws when apiKey is missing', () => {
      expect(() => new TinesClient({ apiKey: '', tenantUrl: mockConfig.tenantUrl })).toThrow(
        'Tines API key is required',
      );
    });

    test('throws when tenantUrl is missing', () => {
      expect(() => new TinesClient({ apiKey: 'key', tenantUrl: '' })).toThrow(
        'Tines tenant URL is required',
      );
    });

    test('throws when tenantUrl is not https', () => {
      expect(() => new TinesClient({ apiKey: 'key', tenantUrl: 'http://tenant.tines.com' })).toThrow(
        'Tines tenant URL must start with https://',
      );
    });

    test('normalizes tenant URL trailing slashes', () => {
      const client = new TinesClient({
        apiKey: 'key',
        tenantUrl: 'https://tenant.tines.com///',
      });
      expect(client.getTenantRoot()).toBe('https://tenant.tines.com');
    });
  });

  describe('getApiKeyPreview', () => {
    test('masks long API keys', () => {
      const client = new TinesClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('test...2345');
    });
  });

  describe('buildQuery', () => {
    test('builds snake_case query string', () => {
      expect(buildQuery({ team_id: 1, per_page: 25, page: 2, tags: undefined })).toBe(
        '?team_id=1&per_page=25&page=2',
      );
    });

    test('returns empty string when no params', () => {
      expect(buildQuery({})).toBe('');
    });
  });

  describe('request', () => {
    let client: TinesClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new TinesClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('GET uses Bearer auth and /api/v1 base URL', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ id: 1, name: 'Story' }]),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await client.request('/stories', {
        params: { team_id: 5, per_page: 10 },
      });

      expect(result).toEqual([{ id: 1, name: 'Story' }]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://tenant.tines.com/api/v1/stories?team_id=5&per_page=10');
      expect((options as RequestInit).method).toBe('GET');
      expect((options as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer test-api-key-12345',
        Accept: 'application/json',
      });
    });

    test('POST sends JSON body', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 2 }),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.request('/stories', {
        method: 'POST',
        body: { team_id: 1, name: 'New Story' },
      });

      const [, options] = fetchMock.mock.calls[0];
      expect((options as RequestInit).method).toBe('POST');
      expect((options as RequestInit).body).toBe(JSON.stringify({ team_id: 1, name: 'New Story' }));
    });

    test('throws TinesApiError on failure', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: () => Promise.resolve({ error: 'Invalid API key' }),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(client.request('/stories')).rejects.toThrow(TinesApiError);
      await expect(client.request('/stories')).rejects.toThrow('Invalid API key');
    });
  });

  describe('sendWebhook', () => {
    let client: TinesClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new TinesClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('POSTs to tenant webhook URL without Bearer auth', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: 'ok' }),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await client.sendWebhook('my-hook', 'secret123', { event: 'test' });
      expect(result).toEqual({ status: 'ok' });

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://tenant.tines.com/webhook/my-hook/secret123');
      expect((options as RequestInit).method).toBe('POST');
      const headers = (options as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      expect((options as RequestInit).body).toBe(JSON.stringify({ event: 'test' }));
    });
  });
});
