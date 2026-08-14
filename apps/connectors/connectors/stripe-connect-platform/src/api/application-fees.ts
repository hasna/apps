import type { ConnectorClient } from './client';
import type {
  ApplicationFee,
  ApplicationFeeListOptions,
  ApplicationFeeRefund,
  StripeList,
} from '../types';

/**
 * Stripe Connect Application Fees API
 * https://docs.stripe.com/api/application_fees
 */
export class ApplicationFeesApi {
  constructor(private readonly client: ConnectorClient) {}

  async get(id: string): Promise<ApplicationFee> {
    return this.client.get<ApplicationFee>(`/application_fees/${id}`);
  }

  async list(options?: ApplicationFeeListOptions): Promise<StripeList<ApplicationFee>> {
    return this.client.get<StripeList<ApplicationFee>>(
      '/application_fees',
      options as Record<string, string | number | boolean | undefined>,
    );
  }

  async createRefund(
    feeId: string,
    params?: { amount?: number; metadata?: Record<string, string> },
  ): Promise<ApplicationFeeRefund> {
    return this.client.post<ApplicationFeeRefund>(`/application_fees/${feeId}/refunds`, params || {});
  }
}
