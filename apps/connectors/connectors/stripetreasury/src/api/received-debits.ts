import type { ConnectorClient } from './client';
import type { ReceivedDebit, ReceivedDebitListOptions, StripeList } from '../types';

/**
 * Stripe Treasury Received Debits API (read-only)
 * https://stripe.com/docs/api/treasury/received_debits
 */
export class ReceivedDebitsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Retrieve a received debit by ID
   */
  async get(id: string): Promise<ReceivedDebit> {
    return this.client.get<ReceivedDebit>(`/treasury/received_debits/${id}`);
  }

  /**
   * List received debits for a financial account
   */
  async list(options: ReceivedDebitListOptions): Promise<StripeList<ReceivedDebit>> {
    return this.client.get<StripeList<ReceivedDebit>>('/treasury/received_debits', options as unknown as Record<string, string | number | boolean | undefined>);
  }
}
