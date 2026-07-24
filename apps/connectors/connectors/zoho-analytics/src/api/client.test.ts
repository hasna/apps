import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ZohoAnalyticsClient } from './client';
import { ZohoAnalytics } from './index';
import { ZohoAnalyticsApiError } from '../types';

describe('ZohoAnalyticsClient', () => {
  const mockConfig = {
    token: 'za-tok',
    orgId: '12345',
    dataCenter: 'com',
  };

  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('constructor', () => {
    test('throws when token is missing', () => {
      expect(() => new ZohoAnalyticsClient({ token: '', orgId: '12345' })).toThrow(
        'Zoho Analytics access token not configured.',
      );
    });

    test('throws when org_id is missing', () => {
      expect(() => new ZohoAnalyticsClient({ token: 'tok', orgId: '' })).toThrow(
        'Zoho Analytics org_id not configured.',
      );
    });

    test('throws for invalid data center', () => {
      expect(() => new ZohoAnalyticsClient({ token: 'tok', orgId: '1', dataCenter: 'invalid' })).toThrow(
        'Zoho Analytics data_center must be one of:',
      );
    });

    test('uses EU data center base URL', () => {
      const client = new ZohoAnalyticsClient({ token: 'tok', orgId: '1', dataCenter: 'eu' });
      expect(client.getBaseUrl()).toBe('https://analyticsapi.zoho.eu');
    });
  });

  describe('request', () => {
    test('sends Zoho-oauthtoken auth and ZANALYTICS-ORGID header', async () => {
      const calls: Array<[string, RequestInit]> = [];
      global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push([String(input), init ?? {}]);
        return {
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ status: 'success', data: {} })),
        } as Response;
      }) as typeof fetch;

      const client = new ZohoAnalyticsClient(mockConfig);
      await client.request('GET', '/workspaces');

      expect(calls).toHaveLength(1);
      const [url, options] = calls[0]!;
      expect(url).toBe('https://analyticsapi.zoho.com/restapi/v2/workspaces');
      expect((options.headers as Record<string, string>).Authorization).toBe('Zoho-oauthtoken za-tok');
      expect((options.headers as Record<string, string>)['ZANALYTICS-ORGID']).toBe('12345');
    });

    test('serializes CONFIG query param for mutating calls', async () => {
      const calls: Array<[string, RequestInit]> = [];
      global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push([String(input), init ?? {}]);
        return {
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ status: 'success' })),
        } as Response;
      }) as typeof fetch;

      const client = new ZohoAnalyticsClient(mockConfig);
      await client.request('POST', '/workspaces', {
        configParam: { workspaceName: 'Sales', workspaceDesc: 'Q3' },
      });

      const [url, options] = calls[0]!;
      expect(options.method).toBe('POST');
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/restapi/v2/workspaces');
      expect(JSON.parse(parsed.searchParams.get('CONFIG') ?? '{}')).toEqual({
        workspaceName: 'Sales',
        workspaceDesc: 'Q3',
      });
    });

    test('runQuery CONFIG includes sqlQuery and default responseFormat', async () => {
      const calls: Array<[string, RequestInit]> = [];
      global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push([String(input), init ?? {}]);
        return {
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ status: 'success' })),
        } as Response;
      }) as typeof fetch;

      const api = new ZohoAnalytics(mockConfig);
      await api.runQuery('ws-1', 'SELECT * FROM Sales');

      const [url, options] = calls[0]!;
      expect(options.method).toBe('POST');
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/restapi/v2/workspaces/ws-1/data');
      expect(JSON.parse(parsed.searchParams.get('CONFIG') ?? '{}')).toEqual({
        sqlQuery: 'SELECT * FROM Sales',
        responseFormat: 'json',
      });
    });

    test('throws ZohoAnalyticsApiError on status failure', async () => {
      global.fetch = (async () =>
        ({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ status: 'failure', summary: 'Invalid request' })),
        }) as Response) as unknown as typeof fetch;

      const client = new ZohoAnalyticsClient(mockConfig);
      await expect(client.request('GET', '/workspaces')).rejects.toThrow('Zoho Analytics: Invalid request');
    });

    test('throws ZohoAnalyticsApiError on non-2xx responses', async () => {
      global.fetch = (async () =>
        ({
          ok: false,
          status: 429,
          text: () => Promise.resolve(JSON.stringify({ summary: 'rate limited' })),
        }) as Response) as unknown as typeof fetch;

      const client = new ZohoAnalyticsClient(mockConfig);
      try {
        await client.request('GET', '/workspaces');
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ZohoAnalyticsApiError);
        expect((err as ZohoAnalyticsApiError).message).toBe('Zoho Analytics: rate limited');
        expect((err as ZohoAnalyticsApiError).statusCode).toBe(429);
      }
    });
  });
});

describe('ZohoAnalytics.fromEnv', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  test('requires ZOHO_ANALYTICS_TOKEN', () => {
    delete process.env.ZOHO_ANALYTICS_TOKEN;
    process.env.ZOHO_ANALYTICS_ORG_ID = '1';
    expect(() => ZohoAnalytics.fromEnv()).toThrow('ZOHO_ANALYTICS_TOKEN is required');
  });

  test('requires ZOHO_ANALYTICS_ORG_ID', () => {
    process.env.ZOHO_ANALYTICS_TOKEN = 'tok';
    delete process.env.ZOHO_ANALYTICS_ORG_ID;
    expect(() => ZohoAnalytics.fromEnv()).toThrow('ZOHO_ANALYTICS_ORG_ID is required');
  });
});
