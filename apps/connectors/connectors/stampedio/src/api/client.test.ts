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
  test('requires public key, private key, and store hash', () => {
    expect(() => new StampedioClient({ publicKey: '', privateKey: 'x', storeHash: 'y' })).toThrow();
    expect(() => new StampedioClient({ publicKey: 'x', privateKey: '', storeHash: 'y' })).toThrow();
    expect(() => new StampedioClient({ publicKey: 'x', privateKey: 'y', storeHash: '' })).toThrow();
  });

  test('reviews.list uses Basic auth and the storeHash dashboard path', async () => {
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

    const expectedAuth = `Basic ${Buffer.from('pub_123:priv_456').toString('base64')}`;
    expect(call.headers.Authorization).toBe(expectedAuth);
  });

  test('reviews.listPublic hits the widget endpoint with apiKey + storeUrl and no auth header', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const stamped = new Stampedio(config);
    await stamped.reviews.listPublic({ productId: 'SKU-2', take: 5 });

    const call = recorded[0];
    expect(call.url).toContain('https://stamped.io/api/widget/reviews');
    expect(call.url).toContain('productId=SKU-2');
    expect(call.url).toContain('apiKey=pub_123');
    expect(call.url).toContain('storeUrl=demo.myshopify.com');
    expect(call.headers.Authorization).toBeUndefined();
  });

  test('customers.add POSTs JSON to the customers/add endpoint', async () => {
    const recorded = installFetch(() => ({ id: 42, email: 'a@b.com' }));
    const stamped = new Stampedio(config);
    await stamped.customers.add({ email: 'a@b.com', name: 'A B' });

    const call = recorded[0];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/v2/store789/dashboard/customers/add');
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(call.body as string)).toEqual({ email: 'a@b.com', name: 'A B' });
  });

  test('loyalty.awardPoints sends positive points to the transactions endpoint', async () => {
    const recorded = installFetch(() => ({ id: 7, pointsBalance: 150 }));
    const stamped = new Stampedio(config);
    await stamped.loyalty.awardPoints('a@b.com', 50, 'signup');

    const call = recorded[0];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/v2/store789/loyalty/transactions');
    const body = JSON.parse(call.body as string);
    expect(body).toEqual({ email: 'a@b.com', points: 50, reason: 'signup', reference: undefined });
  });

  test('loyalty.deductPoints negates the points value', async () => {
    const recorded = installFetch(() => ({ id: 8 }));
    const stamped = new Stampedio(config);
    await stamped.loyalty.deductPoints('a@b.com', 30);

    const body = JSON.parse(recorded[0].body as string);
    expect(body.points).toBe(-30);
  });

  test('non-2xx responses throw a StampedioApiError with status', async () => {
    installFetch(() => ({ status: 401, json: { error: 'Unauthorized' } }));
    const stamped = new Stampedio(config);
    await expect(stamped.reviews.list()).rejects.toMatchObject({
      name: 'StampedioApiError',
      status: 401,
      message: 'Unauthorized',
    });
  });

  test('fromEnv reads credentials from the environment', () => {
    process.env.STAMPEDIO_PUBLIC_KEY = 'envpub';
    process.env.STAMPEDIO_PRIVATE_KEY = 'envpriv';
    process.env.STAMPEDIO_STORE_HASH = 'envhash';
    try {
      const stamped = Stampedio.fromEnv();
      expect(stamped.getClient().getStoreHash()).toBe('envhash');
    } finally {
      delete process.env.STAMPEDIO_PUBLIC_KEY;
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
