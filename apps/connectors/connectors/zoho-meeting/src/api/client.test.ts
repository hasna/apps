import { afterEach, describe, expect, test } from 'bun:test';
import { ZohoMeetingClient, resolveBaseUrl, DC_BASES } from './client';
import { ZohoMeetingApiError } from '../types';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: RecordedRequest[]) => Response | Promise<Response>,
) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const raw = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : (init.headers as Record<string, string>);
      Object.assign(headers, raw);
    }
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return handler(url, init, recorded);
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('ZohoMeetingClient', () => {
  const mockConfig = {
    token: 'test-oauth-token-12345',
    dataCenter: 'com',
  };

  describe('constructor', () => {
    test('throws error when token is missing', () => {
      expect(() => new ZohoMeetingClient({ token: '' })).toThrow('Zoho Meeting token is required');
    });

    test('creates client with valid config', () => {
      const client = new ZohoMeetingClient(mockConfig);
      expect(client).toBeInstanceOf(ZohoMeetingClient);
    });

    test('throws for invalid data center', () => {
      expect(() => new ZohoMeetingClient({ token: 'abc', dataCenter: 'invalid' })).toThrow(
        'Zoho Meeting data_center must be one of',
      );
    });
  });

  describe('resolveBaseUrl', () => {
    test('uses default com data center', () => {
      expect(resolveBaseUrl({ dataCenter: 'com' })).toBe(`${DC_BASES.com}/api/v2`);
    });

    test('uses eu data center', () => {
      expect(resolveBaseUrl({ dataCenter: 'eu' })).toBe(`${DC_BASES.eu}/api/v2`);
    });

    test('honors base URL override', () => {
      expect(resolveBaseUrl({ baseUrl: 'https://custom.example/api/v2/' })).toBe(
        'https://custom.example/api/v2',
      );
    });
  });

  describe('getTokenPreview', () => {
    test('returns masked token for long tokens', () => {
      const client = new ZohoMeetingClient(mockConfig);
      expect(client.getTokenPreview()).toBe('test...2345');
    });

    test('returns *** for short tokens', () => {
      const client = new ZohoMeetingClient({ token: 'short' });
      expect(client.getTokenPreview()).toBe('***');
    });
  });

  describe('request', () => {
    test('makes GET request with Zoho-oauthtoken header', async () => {
      const recorded = installFetch(() =>
        ({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ sessions: [] })),
        }) as Response,
      );

      const client = new ZohoMeetingClient(mockConfig);
      const result = await client.request('/sessions');

      expect(recorded).toHaveLength(1);
      expect(recorded[0].url).toBe('https://meeting.zoho.com/api/v2/sessions');
      expect(recorded[0].method).toBe('GET');
      expect(recorded[0].headers.Authorization).toBe('Zoho-oauthtoken test-oauth-token-12345');
      expect(recorded[0].headers.Accept).toBe('application/json');
      expect(result).toEqual({ sessions: [] });
    });

    test('appends query parameters', async () => {
      const recorded = installFetch(() =>
        ({
          ok: true,
          status: 200,
          text: () => Promise.resolve('{}'),
        }) as Response,
      );

      const client = new ZohoMeetingClient(mockConfig);
      await client.request('/sessions', { params: { from: 0, limit: 10, type: 'upcoming' } });

      expect(recorded[0].url).toContain('from=0');
      expect(recorded[0].url).toContain('limit=10');
      expect(recorded[0].url).toContain('type=upcoming');
    });

    test('makes POST request with JSON body', async () => {
      const recorded = installFetch(() =>
        ({
          ok: true,
          status: 200,
          text: () => Promise.resolve('{"session_key":"abc"}'),
        }) as Response,
      );

      const client = new ZohoMeetingClient(mockConfig);
      await client.request('/sessions', {
        method: 'POST',
        body: { topic: 'Demo', start_time: '2026-07-04T10:00:00Z' },
      });

      expect(recorded[0].method).toBe('POST');
      expect(recorded[0].headers['Content-Type']).toBe('application/json');
      expect(recorded[0].body).toBe(JSON.stringify({ topic: 'Demo', start_time: '2026-07-04T10:00:00Z' }));
    });

    test('handles 204 No Content response', async () => {
      installFetch(() =>
        ({
          ok: true,
          status: 204,
          text: () => Promise.resolve(''),
        }) as Response,
      );

      const client = new ZohoMeetingClient(mockConfig);
      const result = await client.request('/sessions/abc', { method: 'DELETE' });
      expect(result).toEqual({});
    });

    test('throws ZohoMeetingApiError on error response', async () => {
      installFetch(() =>
        ({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: () => Promise.resolve(JSON.stringify({ message: 'Session not found', code: 'NOT_FOUND' })),
        }) as Response,
      );

      const client = new ZohoMeetingClient(mockConfig);
      await expect(client.request('/sessions/missing')).rejects.toThrow(ZohoMeetingApiError);
    });
  });
});
