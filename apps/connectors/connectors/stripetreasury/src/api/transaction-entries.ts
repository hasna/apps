import type { ConnectorClient } from './client';
import type { TransactionEntry, TransactionEntryListOptions, StripeList } from '../types';

/**
 * Stripe Treasury Transaction Entries API (read-only)
 * https://stripe.com/docs/api/treasury/transaction_entries
 */
export class TransactionEntriesApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Retrieve a transaction entry by ID
   */
  async get(id: string): Promise<TransactionEntry> {
    return this.client.get<TransactionEntry>(`/treasury/transaction_entries/${id}`);
  }

  /**
   * List transaction entries for a financial account
   */
  async list(options: TransactionEntryListOptions): Promise<StripeList<TransactionEntry>> {
    return this.client.get<StripeList<TransactionEntry>>('/treasury/transaction_entries', options as unknown as Record<string, string | number | boolean | undefined>);
  }
}
