import type { ConnectorClient } from './client';
import type {
  DebitReversal,
  DebitReversalCreateParams,
  DebitReversalListOptions,
  StripeList,
} from '../types';

/**
 * Stripe Treasury Debit Reversals API
 * https://stripe.com/docs/api/treasury/debit_reversals
 */
export class DebitReversalsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Reverse a received debit
   */
  async create(params: DebitReversalCreateParams): Promise<DebitReversal> {
    return this.client.post<DebitReversal>('/treasury/debit_reversals', params);
  }

  /**
   * Retrieve a debit reversal by ID
   */
  async get(id: string): Promise<DebitReversal> {
    return this.client.get<DebitReversal>(`/treasury/debit_reversals/${id}`);
  }

  /**
   * List debit reversals for a financial account
   */
  async list(options: DebitReversalListOptions): Promise<StripeList<DebitReversal>> {
    return this.client.get<StripeList<DebitReversal>>('/treasury/debit_reversals', options as unknown as Record<string, string | number | boolean | undefined>);
  }
}
