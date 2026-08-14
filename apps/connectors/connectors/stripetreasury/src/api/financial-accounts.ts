import type { ConnectorClient } from './client';
import type {
  FinancialAccount,
  FinancialAccountFeatures,
  FinancialAccountFeatureParams,
  FinancialAccountCreateParams,
  FinancialAccountUpdateParams,
  FinancialAccountListOptions,
  StripeList,
} from '../types';

/**
 * Stripe Treasury Financial Accounts API
 * https://stripe.com/docs/api/treasury/financial_accounts
 */
export class FinancialAccountsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a financial account
   */
  async create(params: FinancialAccountCreateParams): Promise<FinancialAccount> {
    return this.client.post<FinancialAccount>('/treasury/financial_accounts', params);
  }

  /**
   * Retrieve a financial account by ID
   */
  async get(id: string): Promise<FinancialAccount> {
    return this.client.get<FinancialAccount>(`/treasury/financial_accounts/${id}`);
  }

  /**
   * Update a financial account
   */
  async update(id: string, params: FinancialAccountUpdateParams): Promise<FinancialAccount> {
    return this.client.post<FinancialAccount>(`/treasury/financial_accounts/${id}`, params);
  }

  /**
   * List all financial accounts
   */
  async list(options?: FinancialAccountListOptions): Promise<StripeList<FinancialAccount>> {
    return this.client.get<StripeList<FinancialAccount>>('/treasury/financial_accounts', options as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Retrieve the features of a financial account
   */
  async getFeatures(id: string): Promise<FinancialAccountFeatures> {
    return this.client.get<FinancialAccountFeatures>(`/treasury/financial_accounts/${id}/features`);
  }

  /**
   * Update the features of a financial account
   */
  async updateFeatures(id: string, params: FinancialAccountFeatureParams): Promise<FinancialAccountFeatures> {
    return this.client.post<FinancialAccountFeatures>(`/treasury/financial_accounts/${id}/features`, params);
  }
}
