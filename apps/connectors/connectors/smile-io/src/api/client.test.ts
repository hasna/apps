import { afterEach, describe, expect, test } from 'bun:test';
import { Smile, SmileClient } from './index';
import { SmileApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

interface MockResult {
  status?: number;
  json?: unknown;
}

function installFetch(handler: (url: string, init: RequestInit | undefined) => MockResult) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = (init?.headers as Record<string, string>) ?? {};
    recorded.push({ url, method: init?.method ?? 'GET', headers, body: init?.body });
    const { status = 200, json = {} } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('SmileClient transport', () => {
  test('requires an API key', () => {
    expect(() => new SmileClient({ apiKey: '' })).toThrow();
  });

  test('fromEnv requires SMILEIO_API_KEY', () => {
    const prev = process.env.SMILEIO_API_KEY;
    delete process.env.SMILEIO_API_KEY;
    expect(() => Smile.fromEnv()).toThrow(/SMILEIO_API_KEY/);
    if (prev !== undefined) process.env.SMILEIO_API_KEY = prev;
  });

  test('uses the v1 base URL and Bearer authorization header', async () => {
    const recorded = installFetch(() => ({ json: { customers: [], metadata: {} } }));
    const smile = new Smile({ apiKey: 'api_secret_key' });
    await smile.customers.list();

    expect(recorded[0].url).toContain('https://api.smile.io/v1/customers');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.Authorization).toBe('Bearer api_secret_key');
  });

  test('honors a custom base URL and trims a trailing slash', async () => {
    const recorded = installFetch(() => ({ json: { points_settings: { points_label: { one: 'Point', other: 'Points' } } } }));
    const smile = new Smile({ apiKey: 'k', baseUrl: 'https://proxy.example.com/v1/' });
    await smile.pointsSettings.get();

    expect(recorded[0].url).toBe('https://proxy.example.com/v1/points_settings');
  });

  test('serializes query parameters and omits undefined values', async () => {
    const recorded = installFetch(() => ({ json: { customers: [], metadata: {} } }));
    const smile = new Smile({ apiKey: 'k' });
    await smile.customers.list({ email: 'jane@doe.com', state: 'member', limit: 25, cursor: undefined });

    const url = new URL(recorded[0].url);
    expect(url.searchParams.get('email')).toBe('jane@doe.com');
    expect(url.searchParams.get('state')).toBe('member');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.has('cursor')).toBe(false);
  });

  test('sends JSON body for POST and returns the unwrapped resource', async () => {
    const recorded = installFetch(() => ({
      status: 201,
      json: {
        points_transaction: {
          id: 1,
          customer_id: 42,
          points_change: 100,
          description: 'Bonus',
          internal_note: null,
          created_at: 't',
          updated_at: 't',
        },
      },
    }));
    const smile = new Smile({ apiKey: 'k' });
    const tx = await smile.pointsTransactions.create({ customer_id: 42, points_change: 100, description: 'Bonus' });

    const call = recorded[0];
    expect(call.method).toBe('POST');
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(call.body as string)).toEqual({ customer_id: 42, points_change: 100, description: 'Bonus' });
    expect(tx.id).toBe(1);
    expect(tx.points_change).toBe(100);
  });

  test('wraps activity payloads in an activity object', async () => {
    const recorded = installFetch(() => ({
      status: 201,
      json: { activity: { id: 5, customer_id: 42, token: 'activity_x', distinct_id: null, created_on_origin_at: null, created_at: 't', updated_at: 't' } },
    }));
    const smile = new Smile({ apiKey: 'k' });
    await smile.activities.create({ token: 'activity_x', customer_id: 42 });

    expect(JSON.parse(recorded[0].body as string)).toEqual({ activity: { token: 'activity_x', customer_id: 42 } });
  });

  test('purchase targets the nested points_products/{id}/purchase path', async () => {
    const recorded = installFetch(() => ({
      status: 201,
      json: { points_purchase: { id: 9, customer_id: 42, points_product_id: 7, points_spent: 500, reward_fulfillment: {}, created_at: 't', updated_at: 't' } },
    }));
    const smile = new Smile({ apiKey: 'k' });
    await smile.pointsProducts.purchase(7, { customer_id: 42, points_to_spend: 500 });

    expect(recorded[0].url).toContain('/points_products/7/purchase');
    expect(JSON.parse(recorded[0].body as string)).toEqual({ customer_id: 42, points_to_spend: 500 });
  });

  test('raises SmileApiError with status and parsed message on non-2xx', async () => {
    installFetch(() => ({ status: 422, json: { errors: { points_change: ['would result in a negative balance'] } } }));
    const smile = new Smile({ apiKey: 'k' });

    let caught: unknown;
    try {
      await smile.pointsTransactions.create({ customer_id: 1, points_change: -5 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SmileApiError);
    expect((caught as SmileApiError).statusCode).toBe(422);
    expect((caught as SmileApiError).message).toContain('points_change');
  });

  test('parses a string error field', async () => {
    installFetch(() => ({ status: 404, json: { error: 'Not found' } }));
    const smile = new Smile({ apiKey: 'k' });
    await expect(smile.customers.get(999)).rejects.toThrow('Not found');
  });
});
