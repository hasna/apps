import type { ConnectorClient } from './client';
import type { Transaction, TransactionListOptions, StripeList } from '../types';

/**
 * Stripe Treasury Transactions API (read-only)
 * https://stripe.com/docs/api/treasury/transactions
 */
export class TransactionsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Retrieve a transaction by ID
   */
  async get(id: string): Promise<Transaction> {
    return this.client.get<Transaction>(`/treasury/transactions/${id}`);
  }

  /**
   * List transactions for a financial account
   */
  async list(options: TransactionListOptions): Promise<StripeList<Transaction>> {
    return this.client.get<StripeList<Transaction>>('/treasury/transactions', options as unknown as Record<string, string | number | boolean | undefined>);
  }
}
