import { afterEach, describe, expect, test } from 'bun:test';
import { Connector } from './index';
import { ConnectorClient } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(json: unknown = {}): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body as string | undefined,
    });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json);
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Stripe Capital client', () => {
  const testApiKey = 'test_api_key';

  test('requires an API key', () => {
    expect(() => new ConnectorClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('sends Bearer auth and version headers', async () => {
    const recorded = installFetch({ object: 'list', data: [], has_more: false });
    const client = new Connector({ apiKey: testApiKey });
    await client.financingOffers.list();

    expect(recorded[0].headers['Authorization']).toBe(`Bearer ${testApiKey}`);
    expect(recorded[0].headers['Stripe-Version']).toBeDefined();
    expect(recorded[0].headers['Stripe-Account']).toBeUndefined();
    expect(recorded[0].url).toContain('/v1/capital/financing_offers');
    expect(recorded[0].method).toBe('GET');
  });

  test('sets Stripe-Account header when acting on a connected account', async () => {
    const recorded = installFetch({ object: 'capital.financing_summary', status: 'none' });
    const client = new Connector({ apiKey: testApiKey, accountId: 'acct_456' });
    await client.financingSummary.retrieve();

    expect(recorded[0].headers['Stripe-Account']).toBe('acct_456');
    expect(recorded[0].url).toContain('/v1/capital/financing_summary');
  });

  test('passes list filters as query parameters', async () => {
    const recorded = installFetch({ object: 'list', data: [], has_more: false });
    const client = new Connector({ apiKey: testApiKey });
    await client.financingOffers.list({ limit: 5, status: 'accepted', connected_account: 'acct_9' });

    const url = new URL(recorded[0].url);
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('status')).toBe('accepted');
    expect(url.searchParams.get('connected_account')).toBe('acct_9');
  });

  test('markDelivered POSTs form-urlencoded metadata to the mark_delivered path', async () => {
    const recorded = installFetch({ id: 'financingoffer_1', object: 'capital.financing_offer', status: 'delivered' });
    const client = new Connector({ apiKey: testApiKey });
    await client.financingOffers.markDelivered('financingoffer_1', { metadata: { note: 'sent' } });

    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].url).toContain('/v1/capital/financing_offers/financingoffer_1/mark_delivered');
    expect(recorded[0].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(recorded[0].body).toBe('metadata%5Bnote%5D=sent');
  });

  test('financing summary sends no unsupported query parameters', async () => {
    const recorded = installFetch({ object: 'capital.financing_summary', status: 'none' });
    const client = new Connector({ apiKey: testApiKey });
    await client.financingSummary.retrieve();

    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe('/v1/capital/financing_summary');
    expect(url.search).toBe('');
  });
});
