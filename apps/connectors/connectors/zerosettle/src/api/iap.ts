import { encodePathSegment, ZeroSettleClient } from './client';
import type {
  CheckoutSession,
  Entitlement,
  PaymentIntent,
  Product,
  RawRequestOptions,
  TrackEventResponse,
  Transaction,
} from '../types';

export class IapApi {
  constructor(private readonly client: ZeroSettleClient) {}

  getProducts(params?: Record<string, string | number | boolean | undefined>): Promise<Product[] | { products: Product[] }> {
    return this.client.get('/v1/iap/products/', params);
  }

  createPaymentIntent(body: Record<string, unknown>): Promise<PaymentIntent> {
    return this.client.post('/v1/iap/payment-intents/', body);
  }

  createCheckoutSession(body: Record<string, unknown>): Promise<CheckoutSession> {
    return this.client.post('/v1/iap/checkout/sessions/', body);
  }

  getTransaction(transactionId: string): Promise<Transaction> {
    const encodedId = encodePathSegment(transactionId);
    return this.client.get(`/v1/iap/transactions/${encodedId}`);
  }

  getEntitlements(params?: Record<string, string | number | boolean | undefined>): Promise<Entitlement[] | { entitlements: Entitlement[] }> {
    return this.client.get('/v1/iap/entitlements/', params);
  }

  restorePurchases(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.client.post('/v1/iap/restore/', body);
  }

  cancelSubscription(subscriptionId: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const encodedId = encodePathSegment(subscriptionId);
    return this.client.post(`/v1/iap/subscriptions/${encodedId}/cancel`, body);
  }

  trackEvent(body: Record<string, unknown>): Promise<TrackEventResponse> {
    return this.client.post('/v1/iap/events/', body);
  }

  rawRequest(options: RawRequestOptions): Promise<unknown> {
    const method = options.method || 'GET';
    if (method === 'GET') {
      return this.client.get(options.path, options.query);
    }
    return this.client.request(options.path, {
      method,
      params: options.query,
      body: options.body,
    });
  }
}
