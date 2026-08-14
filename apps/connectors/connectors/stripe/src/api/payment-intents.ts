import type { ConnectorClient } from './client';
import type {
  PaymentIntent,
  PaymentIntentCreateParams,
  PaymentIntentUpdateParams,
  PaymentIntentConfirmParams,
  PaymentIntentCancelParams,
  PaymentIntentCaptureParams,
  PaymentIntentListOptions,
  StripeList,
  StripeSearchResult,
} from '../types';

/**
 * Stripe Payment Intents API
 * https://stripe.com/docs/api/payment_intents
 */
export class PaymentIntentsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a payment intent
   */
  async create(params: PaymentIntentCreateParams): Promise<PaymentIntent> {
    return this.client.post<PaymentIntent>('/payment_intents', params);
  }

  /**
   * Retrieve a payment intent by ID
   */
  async get(id: string, options?: { client_secret?: string }): Promise<PaymentIntent> {
    return this.client.get<PaymentIntent>(`/payment_intents/${id}`, options);
  }

  /**
   * Update a payment intent
   */
  async update(id: string, params: PaymentIntentUpdateParams): Promise<PaymentIntent> {
    return this.client.post<PaymentIntent>(`/payment_intents/${id}`, params);
  }

  /**
   * List all payment intents
   */
  async list(options?: PaymentIntentListOptions): Promise<StripeList<PaymentIntent>> {
    return this.client.get<StripeList<PaymentIntent>>('/payment_intents', options as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Confirm a payment intent
   */
  async confirm(id: string, params?: PaymentIntentConfirmParams): Promise<PaymentIntent> {
    return this.client.post<PaymentIntent>(`/payment_intents/${id}/confirm`, params || {});
  }

  /**
   * Cancel a payment intent
   */
  async cancel(id: string, params?: PaymentIntentCancelParams): Promise<PaymentIntent> {
    return this.client.post<PaymentIntent>(`/payment_intents/${id}/cancel`, params || {});
  }

  /**
   * Capture a payment intent (for manual capture)
   */
  async capture(id: string, params?: PaymentIntentCaptureParams): Promise<PaymentIntent> {
    return this.client.post<PaymentIntent>(`/payment_intents/${id}/capture`, params || {});
  }

  /**
   * Search payment intents
   * Query syntax: https://stripe.com/docs/search#query-fields-for-payment-intents
   */
  async search(query: string, options?: { limit?: number; page?: string }): Promise<StripeSearchResult<PaymentIntent>> {
    return this.client.get<StripeSearchResult<PaymentIntent>>('/payment_intents/search', {
      query,
      limit: options?.limit,
      page: options?.page,
    });
  }
}
