import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TicketbudClient } from './client';
import { TicketbudApiError } from '../types';

describe('TicketbudClient', () => {
  const mockConfig = {
    accessToken: 'test-access-token-12345',
  };

  describe('constructor', () => {
    test('throws when access token is missing', () => {
      expect(() => new TicketbudClient({ accessToken: '' })).toThrow('Ticketbud access token is required');
    });

    test('creates client with valid config', () => {
      expect(new TicketbudClient(mockConfig)).toBeInstanceOf(TicketbudClient);
    });
  });

  describe('request', () => {
    let client: TicketbudClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new TicketbudClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('getMe builds URL with access_token and Accept header', async () => {
      const mockResponse = { user: { id: 1, full_name: 'Test User' } };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );

      const result = await client.get('/me.json');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.ticketbud.com/me.json?access_token=test-access-token-12345');
      expect(options.method).toBe('GET');
      expect(options.headers.Accept).toBe('application/json');
      expect(result).toEqual(mockResponse);
    });

    test('put sends PUT for check-in endpoint', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ ticket: { id: 1, checked_in: true } })),
        } as Response),
      );

      await client.put('/events/123/tickets/456/check_in.json', { reverse: 'true' });

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/events/123/tickets/456/check_in.json');
      expect(url).toContain('access_token=test-access-token-12345');
      expect(url).toContain('reverse=true');
      expect(options.method).toBe('PUT');
    });

    test('throws TicketbudApiError on failed response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'invalid_token' })),
        } as Response),
      );

      await expect(client.get('/me.json')).rejects.toThrow(TicketbudApiError);
    });
  });
});
