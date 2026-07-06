import type { ConnectorClient } from './client';
import type {
  OutboundPayment,
  OutboundPaymentCreateParams,
  OutboundPaymentListOptions,
  StripeList,
} from '../types';

/**
 * Stripe Treasury Outbound Payments API
 * https://stripe.com/docs/api/treasury/outbound_payments
 */
export class OutboundPaymentsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create an outbound payment
   */
  async create(params: OutboundPaymentCreateParams): Promise<OutboundPayment> {
    return this.client.post<OutboundPayment>('/treasury/outbound_payments', params);
  }

  /**
   * Retrieve an outbound payment by ID
   */
  async get(id: string): Promise<OutboundPayment> {
    return this.client.get<OutboundPayment>(`/treasury/outbound_payments/${id}`);
  }

  /**
   * List outbound payments for a financial account
   */
  async list(options: OutboundPaymentListOptions): Promise<StripeList<OutboundPayment>> {
    return this.client.get<StripeList<OutboundPayment>>('/treasury/outbound_payments', options as unknown as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Cancel an outbound payment
   */
  async cancel(id: string): Promise<OutboundPayment> {
    return this.client.post<OutboundPayment>(`/treasury/outbound_payments/${id}/cancel`, {});
  }
}
