import type { ConnectorClient } from './client';
import type {
  PaymentLink,
  PaymentLinkCreateParams,
  PaymentLinkUpdateParams,
  PaymentLinkListOptions,
  CheckoutSessionLineItem,
  StripeList,
} from '../types';

/**
 * Stripe Payment Links API
 * https://stripe.com/docs/api/payment-link
 *
 * Creates reusable payment links that can be shared with customers.
 * Unlike Checkout Sessions, Payment Links can be used multiple times.
 */
export class PaymentLinksApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a payment link
   * Returns a link with a URL that can be shared with customers
   */
  async create(params: PaymentLinkCreateParams): Promise<PaymentLink> {
    return this.client.post<PaymentLink>('/payment_links', params);
  }

  /**
   * Retrieve a payment link by ID
   */
  async get(id: string): Promise<PaymentLink> {
    return this.client.get<PaymentLink>(`/payment_links/${id}`);
  }

  /**
   * Update a payment link
   * Can be used to deactivate a link by setting active=false
   */
  async update(id: string, params: PaymentLinkUpdateParams): Promise<PaymentLink> {
    return this.client.post<PaymentLink>(`/payment_links/${id}`, params);
  }

  /**
   * List all payment links
   */
  async list(options?: PaymentLinkListOptions): Promise<StripeList<PaymentLink>> {
    return this.client.get<StripeList<PaymentLink>>('/payment_links', options as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Retrieve a payment link's line items
   */
  async listLineItems(id: string, options?: { limit?: number; starting_after?: string; ending_before?: string }): Promise<StripeList<CheckoutSessionLineItem>> {
    return this.client.get<StripeList<CheckoutSessionLineItem>>(`/payment_links/${id}/line_items`, options);
  }
}
