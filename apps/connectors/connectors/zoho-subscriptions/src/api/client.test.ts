import { afterEach, describe, expect, test } from 'bun:test';
import { ZohoSubscriptionsClient, resolveBaseUrl } from './client';
import { ZohoSubscriptionsApiError } from '../types';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ZohoSubscriptionsClient', () => {
  const mockConfig = {
    token: 'test-token',
    organizationId: 'org-123',
    dataCenter: 'com',
  };

  describe('constructor', () => {
    test('throws when token is missing', () => {
      expect(() => new ZohoSubscriptionsClient({ token: '', organizationId: 'org' })).toThrow(
        'token and organizationId are required',
      );
    });

    test('throws when organizationId is missing', () => {
      expect(() => new ZohoSubscriptionsClient({ token: 'tok', organizationId: '' })).toThrow(
        'token and organizationId are required',
      );
    });

    test('throws for invalid data center', () => {
      expect(() => resolveBaseUrl({ dataCenter: 'invalid' })).toThrow('data_center must be one of');
    });

    test('resolves UK API data center', () => {
      expect(resolveBaseUrl({ dataCenter: 'uk' })).toBe('https://www.zohoapis.uk/billing/v1');
    });
  });

  describe('request', () => {
    test('uses /billing/v1 path with Zoho-oauthtoken and org header', async () => {
      const calls: { url: string; headers: Record<string, string> }[] = [];
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: typeof input === 'string' ? input : input.toString(),
          headers: init?.headers as Record<string, string>,
        });
        return {
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ code: 0, customers: [] })),
        } as Response;
      }) as typeof fetch;

      const client = new ZohoSubscriptionsClient(mockConfig);
      await client.request('/customers');

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://www.zohoapis.com/billing/v1/customers');
      expect(calls[0].headers.Authorization).toBe('Zoho-oauthtoken test-token');
      expect(calls[0].headers['X-com-zoho-subscriptions-organizationid']).toBe('org-123');
    });

    test('maps query parameters', async () => {
      const calls: { url: string }[] = [];
      globalThis.fetch = (async (input: string | URL | Request) => {
        calls.push({ url: typeof input === 'string' ? input : input.toString() });
        return {
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ code: 0, subscriptions: [] })),
        } as Response;
      }) as typeof fetch;

      const client = new ZohoSubscriptionsClient(mockConfig);
      await client.request('/subscriptions', { params: { page: 2, per_page: 50, status: 'live' } });

      expect(calls[0].url).toContain('page=2');
      expect(calls[0].url).toContain('per_page=50');
      expect(calls[0].url).toContain('status=live');
    });

    test('throws ZohoSubscriptionsApiError on non-zero code', async () => {
      globalThis.fetch = (async () =>
        ({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ code: 1002, message: 'Invalid token' })),
        }) as Response) as unknown as typeof fetch;

      const client = new ZohoSubscriptionsClient(mockConfig);
      await expect(client.request('/customers')).rejects.toThrow(ZohoSubscriptionsApiError);
    });

    test('throws on HTTP error response', async () => {
      globalThis.fetch = (async () =>
        ({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: () => Promise.resolve(JSON.stringify({ code: 57, message: 'Unauthorized' })),
        }) as Response) as unknown as typeof fetch;

      const client = new ZohoSubscriptionsClient(mockConfig);
      try {
        await client.request('/customers');
        expect.unreachable('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ZohoSubscriptionsApiError);
        expect((err as ZohoSubscriptionsApiError).statusCode).toBe(401);
      }
    });
  });
});
