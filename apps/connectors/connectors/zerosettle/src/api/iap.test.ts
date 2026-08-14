import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ZeroSettleClient } from './client';
import { IapApi } from './iap';

describe('IapApi', () => {
  let iap: IapApi;
  let originalFetch: typeof global.fetch;
  const captured: Array<{ method: string; url: string; body?: unknown }> = [];

  beforeEach(() => {
    originalFetch = global.fetch;
    captured.length = 0;
    global.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      captured.push({ method: init?.method ?? 'GET', url, body });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;

    iap = new IapApi(new ZeroSettleClient({ publishableKey: 'zs_pk_test_zero' }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('covers documented IAP endpoint matrix', async () => {
    await iap.getProducts({ user_id: 'user 1' });
    await iap.createPaymentIntent({ product_id: 'pro_monthly', user_id: 'user 1' });
    await iap.createCheckoutSession({ product_id: 'pro_monthly', user_id: 'user 1' });
    await iap.getTransaction('txn 1');
    await iap.getEntitlements({ user_id: 'user 1' });
    await iap.restorePurchases({ user_id: 'user 1' });
    await iap.cancelSubscription('sub 1', { reason: 'user requested' });
    await iap.trackEvent({ event: 'checkout_opened', user_id: 'user 1' });

    expect(captured.map((request) => [request.method, request.url])).toEqual([
      ['GET', 'https://api.zerosettle.io/v1/iap/products/?user_id=user+1'],
      ['POST', 'https://api.zerosettle.io/v1/iap/payment-intents/'],
      ['POST', 'https://api.zerosettle.io/v1/iap/checkout/sessions/'],
      ['GET', 'https://api.zerosettle.io/v1/iap/transactions/txn%201'],
      ['GET', 'https://api.zerosettle.io/v1/iap/entitlements/?user_id=user+1'],
      ['POST', 'https://api.zerosettle.io/v1/iap/restore/'],
      ['POST', 'https://api.zerosettle.io/v1/iap/subscriptions/sub%201/cancel'],
      ['POST', 'https://api.zerosettle.io/v1/iap/events/'],
    ]);

    expect(captured[1].body).toEqual({ product_id: 'pro_monthly', user_id: 'user 1' });
    expect(captured[6].body).toEqual({ reason: 'user requested' });
  });

  test('rawRequest supports custom paths and methods', async () => {
    await iap.rawRequest({
      path: '/v1/iap/custom/',
      method: 'POST',
      body: { enabled: true },
    });

    expect(captured[0]).toEqual({
      method: 'POST',
      url: 'https://api.zerosettle.io/v1/iap/custom/',
      body: { enabled: true },
    });
  });

  test('rawRequest forwards DELETE bodies', async () => {
    await iap.rawRequest({
      path: '/v1/iap/custom/',
      method: 'DELETE',
      body: { reason: 'duplicate' },
    });

    expect(captured[0]).toEqual({
      method: 'DELETE',
      url: 'https://api.zerosettle.io/v1/iap/custom/',
      body: { reason: 'duplicate' },
    });
  });
});
