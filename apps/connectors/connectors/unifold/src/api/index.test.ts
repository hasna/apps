import { afterEach, describe, expect, test } from 'bun:test';
import { Unifold } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers, body });
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ ok: true });
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Unifold API client', () => {
  const client = new Unifold({ apiKey: 'unifold-key' });

  test('listUsers sends bearer auth and query params', async () => {
    const recorded = installFetch();
    await client.listUsers({ limit: 5 });
    expect(recorded[0].url).toBe('https://api.unifold.io/v1/users?limit=5');
    expect(recorded[0].headers.authorization || recorded[0].headers.Authorization).toBe('Bearer unifold-key');
  });

  test('getUser encodes path segments', async () => {
    const recorded = installFetch();
    await client.getUser('user 1');
    expect(recorded[0].url).toBe('https://api.unifold.io/v1/users/user%201');
  });

  test('listPaymentIntents supports status filter', async () => {
    const recorded = installFetch();
    await client.listPaymentIntents({ status: 'requires_payment' });
    expect(recorded[0].url).toBe('https://api.unifold.io/v1/payment-intents?status=requires_payment');
  });

  test('getPaymentIntent encodes payment intent ID', async () => {
    const recorded = installFetch();
    await client.getPaymentIntent('pi 1');
    expect(recorded[0].url).toBe('https://api.unifold.io/v1/payment-intents/pi%201');
  });

  test('createPaymentIntent posts JSON body', async () => {
    const recorded = installFetch();
    await client.createPaymentIntent({ amount: 2500, currency: 'USD', userId: 'user 1' });
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].url).toBe('https://api.unifold.io/v1/payment-intents');
    expect(recorded[0].body).toEqual({ amount: 2500, currency: 'USD', userId: 'user 1' });
  });

  test('createTreasuryAccount posts to treasury endpoint', async () => {
    const recorded = installFetch();
    await client.createTreasuryAccount({ userId: 'user 1', network: 'base' });
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].url).toBe('https://api.unifold.io/v1/treasury/accounts');
    expect(recorded[0].body).toEqual({ userId: 'user 1', network: 'base' });
  });

  test('getTreasuryAccount encodes account ID', async () => {
    const recorded = installFetch();
    await client.getTreasuryAccount('acct 1');
    expect(recorded[0].url).toBe('https://api.unifold.io/v1/treasury/accounts/acct%201');
  });

  test('listDepositAddresses supports accountId query', async () => {
    const recorded = installFetch();
    await client.listDepositAddresses({ accountId: 'acct 1' });
    expect(recorded[0].url).toBe('https://api.unifold.io/v1/deposit-addresses?accountId=acct+1');
  });

  test('rawRequest supports custom path and method', async () => {
    const recorded = installFetch();
    await client.rawRequest({ path: '/payment-intents', method: 'POST', body: { amount: 100 } });
    expect(recorded[0].url).toBe('https://api.unifold.io/v1/payment-intents');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toEqual({ amount: 100 });
  });

  test('respects custom base URL', async () => {
    const custom = new Unifold({ apiKey: 'key', baseUrl: 'https://custom.example/v2/' });
    const recorded = installFetch();
    await custom.listUsers();
    expect(recorded[0].url).toBe('https://custom.example/v2/users');
  });
});
