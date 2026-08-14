import type { ConnectorClient } from './client';
import type {
  CheckoutSession,
  CheckoutSessionCreateParams,
  CheckoutSessionListOptions,
  CheckoutSessionLineItem,
  StripeList,
} from '../types';

/**
 * Stripe Checkout Sessions API
 * https://stripe.com/docs/api/checkout/sessions
 *
 * Creates hosted checkout pages with payment links for testing and production use.
 */
export class CheckoutSessionsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a checkout session
   * Returns a session with a URL that customers can visit to complete payment
   */
  async create(params: CheckoutSessionCreateParams): Promise<CheckoutSession> {
    return this.client.post<CheckoutSession>('/checkout/sessions', params);
  }

  /**
   * Retrieve a checkout session by ID
   */
  async get(id: string, options?: { expand?: string[] }): Promise<CheckoutSession> {
    return this.client.get<CheckoutSession>(`/checkout/sessions/${id}`, options as Record<string, string | number | boolean | undefined>);
  }

  /**
   * List all checkout sessions
   */
  async list(options?: CheckoutSessionListOptions): Promise<StripeList<CheckoutSession>> {
    return this.client.get<StripeList<CheckoutSession>>('/checkout/sessions', options as unknown as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Retrieve a checkout session's line items
   */
  async listLineItems(id: string, options?: { limit?: number; starting_after?: string; ending_before?: string }): Promise<StripeList<CheckoutSessionLineItem>> {
    return this.client.get<StripeList<CheckoutSessionLineItem>>(`/checkout/sessions/${id}/line_items`, options);
  }

  /**
   * Expire a checkout session
   * Only sessions in 'open' status can be expired
   */
  async expire(id: string): Promise<CheckoutSession> {
    return this.client.post<CheckoutSession>(`/checkout/sessions/${id}/expire`, {});
  }
}
