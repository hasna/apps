import type { ConnectorClient } from './client';
import type {
  CreditReversal,
  CreditReversalCreateParams,
  CreditReversalListOptions,
  StripeList,
} from '../types';

/**
 * Stripe Treasury Credit Reversals API
 * https://stripe.com/docs/api/treasury/credit_reversals
 */
export class CreditReversalsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Reverse a received credit
   */
  async create(params: CreditReversalCreateParams): Promise<CreditReversal> {
    return this.client.post<CreditReversal>('/treasury/credit_reversals', params);
  }

  /**
   * Retrieve a credit reversal by ID
   */
  async get(id: string): Promise<CreditReversal> {
    return this.client.get<CreditReversal>(`/treasury/credit_reversals/${id}`);
  }

  /**
   * List credit reversals for a financial account
   */
  async list(options: CreditReversalListOptions): Promise<StripeList<CreditReversal>> {
    return this.client.get<StripeList<CreditReversal>>('/treasury/credit_reversals', options as unknown as Record<string, string | number | boolean | undefined>);
  }
}
