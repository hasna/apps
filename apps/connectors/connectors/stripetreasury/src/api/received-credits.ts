import type { ConnectorClient } from './client';
import type { ReceivedCredit, ReceivedCreditListOptions, StripeList } from '../types';

/**
 * Stripe Treasury Received Credits API (read-only)
 * https://stripe.com/docs/api/treasury/received_credits
 */
export class ReceivedCreditsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Retrieve a received credit by ID
   */
  async get(id: string): Promise<ReceivedCredit> {
    return this.client.get<ReceivedCredit>(`/treasury/received_credits/${id}`);
  }

  /**
   * List received credits for a financial account
   */
  async list(options: ReceivedCreditListOptions): Promise<StripeList<ReceivedCredit>> {
    return this.client.get<StripeList<ReceivedCredit>>('/treasury/received_credits', options as unknown as Record<string, string | number | boolean | undefined>);
  }
}
