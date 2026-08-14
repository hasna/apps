import type { ConnectorClient } from './client';
import type {
  IssuingTransaction,
  StripeList,
  TransactionListOptions,
  TransactionUpdateParams,
} from '../types';

/**
 * Stripe Issuing Transactions API
 * https://stripe.com/docs/api/issuing/transactions
 */
export class TransactionsApi {
  constructor(private readonly client: ConnectorClient) {}

  async get(id: string): Promise<IssuingTransaction> {
    return this.client.get<IssuingTransaction>(`/issuing/transactions/${id}`);
  }

  async update(id: string, params: TransactionUpdateParams): Promise<IssuingTransaction> {
    return this.client.post<IssuingTransaction>(`/issuing/transactions/${id}`, params);
  }

  async list(options?: TransactionListOptions): Promise<StripeList<IssuingTransaction>> {
    return this.client.get<StripeList<IssuingTransaction>>(
      '/issuing/transactions',
      options as Record<string, string | number | boolean | undefined>,
    );
  }
}
