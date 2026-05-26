import type {
  PlaidConfig,
  ItemGetResponse,
  AccountsGetResponse,
  TransactionsGetResponse,
  TransactionsSyncResponse,
  BalanceGetResponse,
  IdentityGetResponse,
  AuthGetResponse,
  LinkTokenCreateResponse,
  LinkTokenCreateOptions,
  InstitutionsGetResponse,
  InstitutionGetResponse,
} from '../types';
import { PlaidClient } from './client';

/**
 * Plaid API Client
 * Financial data API for banking, transactions, and identity
 */
export class Plaid {
  private readonly client: PlaidClient;

  constructor(config: PlaidConfig) {
    this.client = new PlaidClient(config);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): Plaid {
    const clientId = process.env.PLAID_CLIENT_ID;
    const secret = process.env.PLAID_SECRET;
    const baseUrl = process.env.PLAID_BASE_URL;

    if (!clientId) {
      throw new Error('PLAID_CLIENT_ID environment variable is required');
    }
    if (!secret) {
      throw new Error('PLAID_SECRET environment variable is required');
    }
    return new Plaid({ clientId, secret, baseUrl });
  }

  // ============================================
  // Link Token Methods
  // ============================================

  /**
   * Create a link token for initializing Plaid Link
   */
  async createLinkToken(options: LinkTokenCreateOptions): Promise<LinkTokenCreateResponse> {
    return this.client.post<LinkTokenCreateResponse>('/link/token/create', options);
  }

  // ============================================
  // Item Methods
  // ============================================

  /**
   * Get information about an Item
   */
  async getItem(accessToken: string): Promise<ItemGetResponse> {
    return this.client.post<ItemGetResponse>('/item/get', { access_token: accessToken });
  }

  /**
   * Remove an Item
   */
  async removeItem(accessToken: string): Promise<{ request_id: string }> {
    return this.client.post<{ request_id: string }>('/item/remove', { access_token: accessToken });
  }

  /**
   * Update an Item's webhook
   */
  async updateItemWebhook(accessToken: string, webhook: string): Promise<ItemGetResponse> {
    return this.client.post<ItemGetResponse>('/item/webhook/update', {
      access_token: accessToken,
      webhook,
    });
  }

  // ============================================
  // Account Methods
  // ============================================

  /**
   * Get accounts associated with an Item
   */
  async getAccounts(accessToken: string, options?: {
    account_ids?: string[];
  }): Promise<AccountsGetResponse> {
    return this.client.post<AccountsGetResponse>('/accounts/get', {
      access_token: accessToken,
      options,
    });
  }

  // ============================================
  // Balance Methods
  // ============================================

  /**
   * Get real-time balance data
   */
  async getBalance(accessToken: string, options?: {
    account_ids?: string[];
    min_last_updated_datetime?: string;
  }): Promise<BalanceGetResponse> {
    return this.client.post<BalanceGetResponse>('/accounts/balance/get', {
      access_token: accessToken,
      options,
    });
  }

  // ============================================
  // Transaction Methods
  // ============================================

  /**
   * Get transactions for an Item
   */
  async getTransactions(accessToken: string, startDate: string, endDate: string, options?: {
    account_ids?: string[];
    count?: number;
    offset?: number;
    include_original_description?: boolean;
    include_personal_finance_category?: boolean;
  }): Promise<TransactionsGetResponse> {
    return this.client.post<TransactionsGetResponse>('/transactions/get', {
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options,
    });
  }

  /**
   * Sync transactions incrementally
   */
  async syncTransactions(accessToken: string, options?: {
    cursor?: string;
    count?: number;
    options?: {
      include_original_description?: boolean;
      include_personal_finance_category?: boolean;
    };
  }): Promise<TransactionsSyncResponse> {
    return this.client.post<TransactionsSyncResponse>('/transactions/sync', {
      access_token: accessToken,
      cursor: options?.cursor,
      count: options?.count,
      options: options?.options,
    });
  }

  /**
   * Refresh transactions for an Item
   */
  async refreshTransactions(accessToken: string): Promise<{ request_id: string }> {
    return this.client.post<{ request_id: string }>('/transactions/refresh', {
      access_token: accessToken,
    });
  }

  // ============================================
  // Identity Methods
  // ============================================

  /**
   * Get identity data for an Item
   */
  async getIdentity(accessToken: string, options?: {
    account_ids?: string[];
  }): Promise<IdentityGetResponse> {
    return this.client.post<IdentityGetResponse>('/identity/get', {
      access_token: accessToken,
      options,
    });
  }

  // ============================================
  // Auth Methods
  // ============================================

  /**
   * Get bank account and routing numbers
   */
  async getAuth(accessToken: string, options?: {
    account_ids?: string[];
  }): Promise<AuthGetResponse> {
    return this.client.post<AuthGetResponse>('/auth/get', {
      access_token: accessToken,
      options,
    });
  }

  // ============================================
  // Institution Methods
  // ============================================

  /**
   * Get institutions
   */
  async getInstitutions(count: number, offset: number, countryCodes: string[], options?: {
    products?: string[];
    routing_numbers?: string[];
    oauth?: boolean;
    include_optional_metadata?: boolean;
  }): Promise<InstitutionsGetResponse> {
    return this.client.post<InstitutionsGetResponse>('/institutions/get', {
      count,
      offset,
      country_codes: countryCodes,
      options,
    });
  }

  /**
   * Get institution by ID
   */
  async getInstitutionById(institutionId: string, countryCodes: string[], options?: {
    include_optional_metadata?: boolean;
    include_status?: boolean;
  }): Promise<InstitutionGetResponse> {
    return this.client.post<InstitutionGetResponse>('/institutions/get_by_id', {
      institution_id: institutionId,
      country_codes: countryCodes,
      options,
    });
  }

  /**
   * Search institutions by name
   */
  async searchInstitutions(query: string, countryCodes: string[], options?: {
    products?: string[];
    oauth?: boolean;
    include_optional_metadata?: boolean;
  }): Promise<InstitutionsGetResponse> {
    return this.client.post<InstitutionsGetResponse>('/institutions/search', {
      query,
      country_codes: countryCodes,
      options,
    });
  }

  // ============================================
  // Sandbox Methods (for testing)
  // ============================================

  /**
   * Create a test Item (sandbox only)
   */
  async sandboxPublicTokenCreate(institutionId: string, initialProducts: string[], options?: {
    webhook?: string;
    override_username?: string;
    override_password?: string;
  }): Promise<{ public_token: string; request_id: string }> {
    return this.client.post<{ public_token: string; request_id: string }>('/sandbox/public_token/create', {
      institution_id: institutionId,
      initial_products: initialProducts,
      options,
    });
  }

  /**
   * Exchange public token for access token
   */
  async exchangePublicToken(publicToken: string): Promise<{ access_token: string; item_id: string; request_id: string }> {
    return this.client.post<{ access_token: string; item_id: string; request_id: string }>('/item/public_token/exchange', {
      public_token: publicToken,
    });
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get a preview of the client ID
   */
  getClientIdPreview(): string {
    return this.client.getClientIdPreview();
  }

  /**
   * Get current environment
   */
  getEnvironment(): string {
    return this.client.getEnvironment();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): PlaidClient {
    return this.client;
  }
}

export { PlaidClient } from './client';
