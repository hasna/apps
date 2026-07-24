import { afterEach, describe, expect, test } from 'bun:test';
import { Yotpo, YotpoClient } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  body?: string;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const json = handler(url, init, recorded);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
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

describe('YotpoClient authentication', () => {
  test('exchanges store id + secret for utoken via POST /oauth/token', async () => {
    const recorded = installFetch((url) => {
      if (url.includes('/oauth/token')) {
        return { access_token: 'utoken-abc', token_type: 'bearer', expires_in: 1209600 };
      }
      return { reviews: [] };
    });

    const client = new YotpoClient({
      storeId: 'store-123',
      apiSecret: 'secret-456',
    });

    await client.get('/v1/apps/store-123/reviews');

    const tokenCall = recorded.find(r => r.url.includes('/oauth/token'))!;
    expect(tokenCall.method).toBe('POST');
    const body = JSON.parse(tokenCall.body!);
    expect(body).toEqual({
      client_id: 'store-123',
      client_secret: 'secret-456',
      grant_type: 'client_credentials',
    });

    const reviewsCall = recorded.find(r => r.url.includes('/v1/apps/store-123/reviews'))!;
    expect(reviewsCall.url).toContain('utoken=utoken-abc');
  });

  test('requires store id and api secret', () => {
    expect(() => new YotpoClient({ storeId: '', apiSecret: 'x' })).toThrow('Store ID');
    expect(() => new YotpoClient({ storeId: 'x', apiSecret: '' })).toThrow('API secret');
  });
});

describe('Yotpo reviews API', () => {
  test('listReviews hits /v1/apps/{storeId}/reviews with utoken query param', async () => {
    const recorded = installFetch((url) => {
      if (url.includes('/oauth/token')) {
        return { access_token: 'tok', token_type: 'bearer' };
      }
      if (url.includes('/reviews')) {
        return { reviews: [{ id: 1, score: 5, title: 'Great' }] };
      }
      return {};
    });

    const yotpo = new Yotpo({ storeId: 'app-key', apiSecret: 'sec' });
    const result = await yotpo.listReviews({ count: 10, page: 1 });

    expect(result.reviews).toHaveLength(1);
    const listCall = recorded.find(r => r.url.includes('/v1/apps/app-key/reviews') && !r.url.includes('/oauth/'))!;
    expect(listCall.method).toBe('GET');
    expect(listCall.url).toContain('utoken=tok');
    expect(listCall.url).toContain('count=10');
    expect(listCall.url).toContain('page=1');
  });

  test('getReview uses review id path segment', async () => {
    const recorded = installFetch((url) => {
      if (url.includes('/oauth/token')) return { access_token: 'tok', token_type: 'bearer' };
      if (url.includes('/reviews/42')) return { review: { id: 42, score: 4 } };
      return {};
    });

    const yotpo = new Yotpo({ storeId: 'app-key', apiSecret: 'sec' });
    const result = await yotpo.getReview(42);

    expect(result.review?.id).toBe(42);
    const getCall = recorded.find(r => r.url.includes('/v1/apps/app-key/reviews/42'))!;
    expect(getCall.url).toContain('utoken=tok');
  });

  test('createReview POSTs to /reviews/dynamic_create with appkey and utoken in body', async () => {
    const recorded = installFetch((url, init) => {
      if (url.includes('/oauth/token')) return { access_token: 'tok', token_type: 'bearer' };
      if (url.includes('/reviews/dynamic_create')) {
        const body = JSON.parse(init?.body as string);
        expect(body.appkey).toBe('app-key');
        expect(body.utoken).toBe('tok');
        return { code: 200, review: { id: 99 } };
      }
      return {};
    });

    const yotpo = new Yotpo({ storeId: 'app-key', apiSecret: 'sec' });
    const result = await yotpo.createReview({
      sku: 'SKU-1',
      product_title: 'Widget',
      product_url: 'https://example.com/widget',
      display_name: 'Jane',
      email: 'jane@example.com',
      review_title: 'Love it',
      review_content: 'Great product',
      review_score: 5,
    });

    expect(result.review?.id).toBe(99);
    const createCall = recorded.find(r => r.url.includes('/reviews/dynamic_create'))!;
    expect(createCall.method).toBe('POST');
  });
});
