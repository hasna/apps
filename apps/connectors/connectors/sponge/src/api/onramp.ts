import { SpongeClient, compact } from './client';
import type {
  OnrampCryptoParams,
  CoinbaseOnrampUrlParams,
  StripeOnrampSessionParams,
} from '../types';

/**
 * Fiat onramp API — Coinbase and Stripe hosted onramps plus a provider-auto
 * crypto onramp.
 */
export class OnrampApi {
  constructor(private readonly client: SpongeClient) {}

  /** Create a crypto onramp (provider auto-selected unless specified). */
  crypto(params: OnrampCryptoParams): Promise<unknown> {
    return this.client.post('/api/onramp/crypto', compact({ ...params }));
  }

  // Coinbase onramp

  coinbaseStatus(): Promise<unknown> {
    return this.client.get('/api/coinbase-onramp/status');
  }

  coinbaseSupported(): Promise<unknown> {
    return this.client.get('/api/coinbase-onramp/supported');
  }

  coinbaseUrl(params: CoinbaseOnrampUrlParams): Promise<unknown> {
    return this.client.post('/api/coinbase-onramp/url', compact({ ...params }));
  }

  coinbaseSessionStatus(sessionToken: string): Promise<unknown> {
    return this.client.get(`/api/coinbase-onramp/session/${encodeURIComponent(sessionToken)}/status`);
  }

  coinbaseSessionAbandon(sessionToken: string): Promise<unknown> {
    return this.client.post(`/api/coinbase-onramp/session/${encodeURIComponent(sessionToken)}/abandon`, {});
  }

  // Stripe onramp

  stripeStatus(): Promise<unknown> {
    return this.client.get('/api/stripe-onramp/status');
  }

  stripeSupported(): Promise<unknown> {
    return this.client.get('/api/stripe-onramp/supported');
  }

  stripeSession(params: StripeOnrampSessionParams): Promise<unknown> {
    return this.client.post('/api/stripe-onramp/session', compact({ ...params }));
  }

  stripeSessionStatus(sessionId: string): Promise<unknown> {
    return this.client.get(`/api/stripe-onramp/session/${encodeURIComponent(sessionId)}/status`);
  }

  stripeSessionAbandon(sessionId: string): Promise<unknown> {
    return this.client.post(`/api/stripe-onramp/session/${encodeURIComponent(sessionId)}/abandon`, {});
  }
}
