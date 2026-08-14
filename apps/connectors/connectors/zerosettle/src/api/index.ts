import { ZeroSettleClient } from './client';
import { IapApi } from './iap';
import type { ZeroSettleConfig } from '../types';

export { ZeroSettleClient, DEFAULT_BASE_URL, encodePathSegment } from './client';
export { IapApi } from './iap';

export class ZeroSettle {
  private readonly client: ZeroSettleClient;
  readonly iap: IapApi;

  constructor(config: ZeroSettleConfig) {
    this.client = new ZeroSettleClient(config);
    this.iap = new IapApi(this.client);
  }

  getProducts(params?: Record<string, string | number | boolean | undefined>) {
    return this.iap.getProducts(params);
  }

  createPaymentIntent(body: Record<string, unknown>) {
    return this.iap.createPaymentIntent(body);
  }

  createCheckoutSession(body: Record<string, unknown>) {
    return this.iap.createCheckoutSession(body);
  }

  getTransaction(transactionId: string) {
    return this.iap.getTransaction(transactionId);
  }

  getEntitlements(params?: Record<string, string | number | boolean | undefined>) {
    return this.iap.getEntitlements(params);
  }

  restorePurchases(body: Record<string, unknown>) {
    return this.iap.restorePurchases(body);
  }

  cancelSubscription(subscriptionId: string, body?: Record<string, unknown>) {
    return this.iap.cancelSubscription(subscriptionId, body);
  }

  trackEvent(body: Record<string, unknown>) {
    return this.iap.trackEvent(body);
  }

  rawRequest(options: Parameters<IapApi['rawRequest']>[0]) {
    return this.iap.rawRequest(options);
  }
}
