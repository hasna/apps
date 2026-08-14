import { afterEach, describe, expect, test } from 'bun:test';
import { Stampedio, StampedioClient } from './index';
import { StampedioApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => { status?: number; json?: unknown } | unknown
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) headers[k] = v;
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers, body: init?.body });
    const result = handler(url, init) as { status?: number; json?: unknown } | undefined;
    const status = result && typeof result === 'object' && 'status' in result ? (result.status as number) : 200;
    const payload = result && typeof result === 'object' && 'json' in result ? result.json : result ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      async text() {
        return JSON.stringify(payload ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const config = {
  publicKey: 'pub_123',
  privateKey: 'priv_456',
  storeHash: 'store789',
  storeUrl: 'demo.myshopify.com',
};

describe('StampedioClient transport', () => {
  test('requires private key and store hash for private API requests', () => {
    expect(() => new StampedioClient({ privateKey: '', storeHash: 'y' })).toThrow();
    expect(() => new StampedioClient({ privateKey: 'x', storeHash: '' })).toThrow();
    expect(() => new StampedioClient({ privateKey: 'x', storeHash: 'y' })).not.toThrow();
  });

  test('reviews.list uses stamped-api-key auth and the documented Reviews V2 path', async () => {
    const recorded = installFetch(() => ({ data: [{ id: 1, rating: 5 }], total: 1 }));
    const stamped = new Stampedio(config);
    const result = await stamped.reviews.list({ productId: 'SKU-1', minRating: 4, page: 2, take: 10 });

    expect(result.total).toBe(1);
    const call = recorded[0];
    expect(call.method).toBe('GET');
    expect(call.url).toContain('https://stamped.io/api/v2/store789/dashboard/reviews');
    expect(call.url).toContain('productId=SKU-1');
    expect(call.url).toContain('minRating=4');
    expect(call.url).toContain('page=2');
    expect(call.url).toContain('take=10');
    expect(call.headers['stamped-api-key']).toBe('priv_456');
    expect(call.headers.Authorization).toBeUndefined();
  });

  test('reviews.listPublic hits the widget endpoint with apiKey + storeUrl and no private auth header', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const stamped = new Stampedio(config);
    await stamped.reviews.listPublic({ productId: 'SKU-2', take: 5 });

    const call = recorded[0];
    expect(call.url).toContain('https://stamped.io/api/widget/reviews');
    expect(call.url).toContain('productId=SKU-2');
    expect(call.url).toContain('apiKey=pub_123');
    expect(call.url).toContain('storeUrl=demo.myshopify.com');
    expect(call.headers['stamped-api-key']).toBeUndefined();
    expect(call.headers.Authorization).toBeUndefined();
  });

  test('public widget requests require a public key only when called', async () => {
    const stamped = new Stampedio({ privateKey: 'priv_456', storeHash: 'store789' });
    await expect(stamped.reviews.listPublic()).rejects.toThrow('public key is required');
  });

  test('customers.add POSTs JSON to the documented v3 customer endpoint', async () => {
    const recorded = installFetch(() => ({ customerId: 'cus_42', email: 'a@b.com' }));
    const stamped = new Stampedio(config);
    await stamped.customers.add({
      email: 'a@b.com',
      customCustomerId: 'platform-42',
      firstName: 'A',
      lastName: 'B',
      tags: ['vip', 'newsletter'],
    });

    const call = recorded[0];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/v3/merchant/shops/store789/customers');
    expect(call.headers['stamped-api-key']).toBe('priv_456');
    expect(call.headers.Authorization).toBeUndefined();
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(call.body as string)).toEqual({
      email: 'a@b.com',
      customCustomerId: 'platform-42',
      firstName: 'A',
      lastName: 'B',
      tags: ['vip', 'newsletter'],
    });
  });

  test('loyalty.awardPoints sends positive points to the documented v3 adjust-points endpoint', async () => {
    const recorded = installFetch(() => ({ activityId: 'act_7', customerId: 'cus_42' }));
    const stamped = new Stampedio(config);
    await stamped.loyalty.awardPoints('cus_42', 50, 'signup');

    const call = recorded[0];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/v3/loyalty/shops/store789/customers/cus_42/adjust-points');
    expect(call.headers['stamped-api-key']).toBe('priv_456');
    expect(call.headers.Authorization).toBeUndefined();
    expect(JSON.parse(call.body as string)).toEqual({ points: 50, reason: 'signup' });
  });

  test('loyalty.deductPoints negates the points value', async () => {
    const recorded = installFetch(() => ({ activityId: 'act_8' }));
    const stamped = new Stampedio(config);
    await stamped.loyalty.deductPoints('cus_42', 30);

    const body = JSON.parse(recorded[0].body as string);
    expect(recorded[0].url).toContain('/v3/loyalty/shops/store789/customers/cus_42/adjust-points');
    expect(body.points).toBe(-30);
  });

  test('loyalty adjustments require the documented customerId path parameter', async () => {
    const stamped = new Stampedio(config);
    await expect(stamped.loyalty.adjustPoints({ points: 30 } as never)).rejects.toThrow('customerId is required');
  });

  test('non-2xx responses throw a StampedioApiError with status', async () => {
    installFetch(() => ({ status: 401, json: { message: 'Unauthorized' } }));
    const stamped = new Stampedio(config);
    await expect(stamped.reviews.list()).rejects.toMatchObject({
      name: 'StampedioApiError',
      status: 401,
      message: 'Unauthorized',
    });
  });

  test('fromEnv reads private credentials from the environment and keeps public key optional', () => {
    process.env.STAMPEDIO_PRIVATE_KEY = 'envpriv';
    process.env.STAMPEDIO_STORE_HASH = 'envhash';
    try {
      const stamped = Stampedio.fromEnv();
      expect(stamped.getClient().getStoreHash()).toBe('envhash');
    } finally {
      delete process.env.STAMPEDIO_PRIVATE_KEY;
      delete process.env.STAMPEDIO_STORE_HASH;
    }
  });

  test('StampedioApiError is exported and carries status/code', () => {
    const err = new StampedioApiError('boom', 500, 'X');
    expect(err.status).toBe(500);
    expect(err.code).toBe('X');
  });
});
