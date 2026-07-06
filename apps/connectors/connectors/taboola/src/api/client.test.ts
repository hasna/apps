import { afterEach, describe, expect, test } from 'bun:test';
import { Connector } from './index';
import { ConnectorApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Install a mock fetch. `handler` returns the JSON body for API calls; token
 * requests to /oauth/token are answered automatically unless overridden.
 */
function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown,
  status = 200
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body,
      headers: (init?.headers as Record<string, string>) ?? {},
    });

    if (url.includes('/oauth/token')) {
      return jsonResponse(
        { access_token: 'tok-123', token_type: 'Bearer', expires_in: 43200 },
        200
      );
    }

    return jsonResponse(handler(url, init, recorded) ?? {}, status);
  }) as typeof fetch;
  return recorded;
}

function jsonResponse(json: unknown, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    async text() {
      return JSON.stringify(json ?? {});
    },
  } as unknown as Response;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

function makeConnector() {
  return new Connector({ clientId: 'cid', clientSecret: 'secret', accountId: 'acct-1' });
}

describe('Taboola Backstage client', () => {
  test('fetches a client_credentials token before the first API call', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const taboola = makeConnector();
    await taboola.campaigns.list('acct-1');

    const tokenCall = recorded.find(r => r.url.includes('/oauth/token'))!;
    expect(tokenCall).toBeDefined();
    expect(tokenCall.method).toBe('POST');
    const params = new URLSearchParams(tokenCall.body as string);
    expect(params.get('grant_type')).toBe('client_credentials');
    expect(params.get('client_id')).toBe('cid');
    expect(params.get('client_secret')).toBe('secret');
  });

  test('sends the Bearer token and hits the campaigns endpoint', async () => {
    const recorded = installFetch(() => ({ results: [{ id: 'c1', name: 'Camp' }] }));
    const taboola = makeConnector();
    const result = await taboola.campaigns.list('acct-1');

    expect(result.results[0].id).toBe('c1');
    const apiCall = recorded.find(r => r.url.includes('/campaigns/'))!;
    expect(apiCall.url).toBe('https://backstage.taboola.com/backstage/api/1.0/acct-1/campaigns/');
    expect((apiCall.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  test('reuses the cached token across multiple calls', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const taboola = makeConnector();
    await taboola.campaigns.list('acct-1');
    await taboola.account.listAllowed();

    const tokenCalls = recorded.filter(r => r.url.includes('/oauth/token'));
    expect(tokenCalls.length).toBe(1);
  });

  test('allowed-accounts uses the users/current path', async () => {
    const recorded = installFetch(() => ({ results: [{ account_id: 'acct-1', id: 'acct-1', name: 'A' }] }));
    const taboola = makeConnector();
    await taboola.account.listAllowed();

    const apiCall = recorded.find(r => r.url.includes('allowed-accounts'))!;
    expect(apiCall.url).toBe(
      'https://backstage.taboola.com/backstage/api/1.0/users/current/allowed-accounts'
    );
  });

  test('create campaign POSTs the body to the campaigns collection', async () => {
    const recorded = installFetch(() => ({ id: 'new-c', name: 'Summer' }));
    const taboola = makeConnector();
    await taboola.campaigns.create('acct-1', {
      name: 'Summer',
      branding_text: 'Acme',
      cpc: 0.35,
      spending_limit: 5000,
    });

    const apiCall = recorded.find(r => r.url.endsWith('/campaigns/') && r.method === 'POST')!;
    const body = JSON.parse(apiCall.body as string);
    expect(body.name).toBe('Summer');
    expect(body.cpc).toBe(0.35);
    expect((apiCall.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  test('campaign item paths nest under the campaign', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const taboola = makeConnector();
    await taboola.items.list('acct-1', 'camp-9');

    const apiCall = recorded.find(r => r.url.includes('/items/'))!;
    expect(apiCall.url).toBe(
      'https://backstage.taboola.com/backstage/api/1.0/acct-1/campaigns/camp-9/items/'
    );
  });

  test('campaign summary report encodes dimension and date range', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const taboola = makeConnector();
    await taboola.reports.campaignSummary('acct-1', 'day', {
      start_date: '2026-01-01',
      end_date: '2026-01-31',
    });

    const apiCall = recorded.find(r => r.url.includes('reports/campaign-summary'))!;
    expect(apiCall.url).toContain('/reports/campaign-summary/dimensions/day');
    expect(apiCall.url).toContain('start_date=2026-01-01');
    expect(apiCall.url).toContain('end_date=2026-01-31');
  });

  test('surfaces API errors as ConnectorApiError', async () => {
    installFetch(() => ({ message: 'Invalid campaign' }), 400);
    const taboola = makeConnector();
    await expect(taboola.campaigns.get('acct-1', 'bad')).rejects.toBeInstanceOf(ConnectorApiError);
  });

  test('requires credentials or an access token', () => {
    expect(() => new Connector({ accountId: 'acct-1' })).toThrow();
  });

  test('accepts a pre-issued access token without a token request', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const taboola = new Connector({ accessToken: 'preset-token', accountId: 'acct-1' });
    await taboola.campaigns.list('acct-1');

    expect(recorded.some(r => r.url.includes('/oauth/token'))).toBe(false);
    const apiCall = recorded.find(r => r.url.includes('/campaigns/'))!;
    expect((apiCall.headers as Record<string, string>).Authorization).toBe('Bearer preset-token');
  });
});
