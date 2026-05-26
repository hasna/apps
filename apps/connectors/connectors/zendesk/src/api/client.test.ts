import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ZendeskClient } from './client';
import { ZendeskApiError } from '../types';

describe('ZendeskClient', () => {
  const mockConfig = {
    email: 'test@example.com',
    apiToken: 'test-api-token-12345',
    baseUrl: 'https://test.zendesk.com/api/v2',
  };

  describe('constructor', () => {
    test('throws error when email is missing', () => {
      expect(() => new ZendeskClient({ email: '', apiToken: 'token' })).toThrow('Email and API token are required');
    });

    test('throws error when apiToken is missing', () => {
      expect(() => new ZendeskClient({ email: 'test@example.com', apiToken: '' })).toThrow('Email and API token are required');
    });

    test('creates client with valid config', () => {
      const client = new ZendeskClient(mockConfig);
      expect(client).toBeInstanceOf(ZendeskClient);
    });

    test('uses default base URL when not provided', () => {
      const client = new ZendeskClient({ email: 'test@example.com', apiToken: 'token' });
      expect(client).toBeInstanceOf(ZendeskClient);
    });
  });

  describe('getApiTokenPreview', () => {
    test('returns masked token for long tokens', () => {
      const client = new ZendeskClient(mockConfig);
      const preview = client.getApiTokenPreview();
      expect(preview).toBe('test-a...2345');
    });

    test('returns *** for short tokens', () => {
      const client = new ZendeskClient({ ...mockConfig, apiToken: 'short' });
      const preview = client.getApiTokenPreview();
      expect(preview).toBe('***');
    });
  });

  describe('getEmail', () => {
    test('returns the configured email', () => {
      const client = new ZendeskClient(mockConfig);
      expect(client.getEmail()).toBe('test@example.com');
    });
  });

  describe('request methods', () => {
    let client: ZendeskClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new ZendeskClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() makes GET request with correct headers', async () => {
      const mockResponse = { tickets: [] };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );

      const result = await client.get('/tickets.json');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://test.zendesk.com/api/v2/tickets.json');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toMatch(/^Basic /);
      expect(options.headers.Accept).toBe('application/json');
      expect(result).toEqual(mockResponse);
    });

    test('get() appends query parameters', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response)
      );

      await client.get('/tickets.json', { page: 1, per_page: 25 });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('page=1');
      expect(url).toContain('per_page=25');
    });

    test('post() makes POST request with body', async () => {
      const mockResponse = { ticket: { id: 1 } };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );

      const body = { ticket: { subject: 'Test' } };
      const result = await client.post('/tickets.json', body);

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
      expect(result).toEqual(mockResponse);
    });

    test('put() makes PUT request', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response)
      );

      await client.put('/tickets/1.json', { ticket: { status: 'open' } });

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('PUT');
    });

    test('patch() makes PATCH request', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response)
      );

      await client.patch('/webhooks/123.json', { webhook: { name: 'Updated' } });

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('PATCH');
    });

    test('delete() makes DELETE request', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response)
      );

      await client.delete('/tickets/1.json');

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('DELETE');
    });

    test('head() makes HEAD request', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
        } as Response)
      );

      const result = await client.head<{ active: boolean; statusCode: number }>('/check.json');

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('HEAD');
      expect(result.active).toBe(true);
      expect(result.statusCode).toBe(204);
    });

    test('handles 204 No Content response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response)
      );

      const result = await client.delete('/tickets/1.json');
      expect(result).toEqual({});
    });

    test('handles 206 Partial Content (pagination)', async () => {
      const mockResponse = { tickets: [{ id: 1 }] };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 206,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      );

      const result = await client.get<{ tickets: unknown[]; _hasMore?: boolean }>('/tickets.json');
      expect(result._hasMore).toBe(true);
    });

    test('throws ZendeskApiError on 4xx response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'RecordNotFound' })),
        } as Response)
      );

      await expect(client.get('/tickets/999.json')).rejects.toThrow(ZendeskApiError);
    });

    test('throws ZendeskApiError on 5xx response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'InternalError' })),
        } as Response)
      );

      try {
        await client.get('/tickets.json');
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ZendeskApiError);
        expect((error as ZendeskApiError).statusCode).toBe(500);
      }
    });

    test('handles XML response format', async () => {
      const xmlResponse = '<ticket><id>1</id></ticket>';
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/xml' }),
          text: () => Promise.resolve(xmlResponse),
        } as Response)
      );

      const result = await client.get('/tickets/1.json', undefined, 'xml');
      expect(result).toBe(xmlResponse);
    });

    test('handles empty response body', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(''),
        } as Response)
      );

      const result = await client.get('/empty.json');
      expect(result).toBeUndefined();
    });

    test('handles malformed JSON response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('not valid json'),
        } as Response)
      );

      const result = await client.get('/malformed.json');
      expect(result).toBe('not valid json');
    });

    test('filters out undefined/null query params', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response)
      );

      await client.get('/tickets.json', { page: 1, per_page: undefined, sort: null as unknown as string });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('page=1');
      expect(url).not.toContain('per_page');
      expect(url).not.toContain('sort');
    });
  });
});
