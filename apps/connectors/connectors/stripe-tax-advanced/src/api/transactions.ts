import type { ConnectorClient } from './client';
import type {
  CreateTaxTransactionFromCalculationParams,
  CreateTaxTransactionReversalParams,
  ListOptions,
  StripeList,
  TaxTransaction,
  TaxTransactionLineItem,
} from '../types';

/**
 * Stripe Tax Transactions API
 * https://docs.stripe.com/api/tax/transactions
 */
export class TransactionsApi {
  constructor(private readonly client: ConnectorClient) {}

  async createFromCalculation(params: CreateTaxTransactionFromCalculationParams): Promise<TaxTransaction> {
    return this.client.post<TaxTransaction>(
      '/tax/transactions/create_from_calculation',
      params as unknown as Record<string, unknown>
    );
  }

  async createReversal(params: CreateTaxTransactionReversalParams): Promise<TaxTransaction> {
    return this.client.post<TaxTransaction>(
      '/tax/transactions/create_reversal',
      params as unknown as Record<string, unknown>
    );
  }

  async get(id: string, expand?: string[]): Promise<TaxTransaction> {
    const params: Record<string, string> = {};
    if (expand?.length) {
      params.expand = expand.join(',');
    }
    return this.client.get<TaxTransaction>(`/tax/transactions/${id}`, params);
  }

  async listLineItems(id: string, options?: ListOptions): Promise<StripeList<TaxTransactionLineItem>> {
    return this.client.get<StripeList<TaxTransactionLineItem>>(
      `/tax/transactions/${id}/line_items`,
      options as Record<string, string | number | boolean | undefined>
    );
  }
}
