import type {
  CoinbaseConfig,
  User,
  Account,
  AccountsResponse,
  AccountResponse,
  Address,
  Transaction,
  SendMoneyRequest,
  SpotPrice,
  BuyPrice,
  SellPrice,
  ExchangeRatesResponse,
  CurrenciesResponse,
  TimeResponse,
  PaginatedResponse,
} from '../types';
import { CoinbaseClient } from './client';

/**
 * Coinbase Connector
 * Cryptocurrency accounts, prices, and transactions
 */
export class Coinbase {
  private readonly client: CoinbaseClient;

  constructor(config: CoinbaseConfig) {
    this.client = new CoinbaseClient(config);
  }

  /**
   * Create a client from environment variables
   * Looks for COINBASE_API_KEY and COINBASE_API_SECRET
   */
  static fromEnv(): Coinbase {
    const apiKey = process.env.COINBASE_API_KEY;
    const apiSecret = process.env.COINBASE_API_SECRET;
    const baseUrl = process.env.COINBASE_BASE_URL;

    if (!apiKey) {
      throw new Error('COINBASE_API_KEY environment variable is required');
    }
    if (!apiSecret) {
      throw new Error('COINBASE_API_SECRET environment variable is required');
    }
    return new Coinbase({ apiKey, apiSecret, baseUrl });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): CoinbaseClient {
    return this.client;
  }

  // ============================================
  // User API
  // ============================================

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<{ data: User }> {
    return this.client.get<{ data: User }>('/v2/user');
  }

  /**
   * Get user by ID
   */
  async getUser(userId: string): Promise<{ data: User }> {
    return this.client.get<{ data: User }>(`/v2/users/${userId}`);
  }

  /**
   * Update current user
   */
  async updateCurrentUser(updates: {
    name?: string;
    time_zone?: string;
    native_currency?: string;
  }): Promise<{ data: User }> {
    return this.client.put<{ data: User }>('/v2/user', updates);
  }

  // ============================================
  // Accounts API
  // ============================================

  /**
   * List accounts
   */
  async listAccounts(options?: {
    limit?: number;
    order?: 'asc' | 'desc';
    starting_after?: string;
    ending_before?: string;
  }): Promise<AccountsResponse> {
    return this.client.get<AccountsResponse>('/v2/accounts', options as Record<string, string | number>);
  }

  /**
   * Get account by ID
   */
  async getAccount(accountId: string): Promise<AccountResponse> {
    return this.client.get<AccountResponse>(`/v2/accounts/${accountId}`);
  }

  /**
   * Update account
   */
  async updateAccount(accountId: string, name: string): Promise<AccountResponse> {
    return this.client.put<AccountResponse>(`/v2/accounts/${accountId}`, { name });
  }

  /**
   * Delete account
   */
  async deleteAccount(accountId: string): Promise<void> {
    await this.client.delete<void>(`/v2/accounts/${accountId}`);
  }

  // ============================================
  // Addresses API
  // ============================================

  /**
   * List addresses for an account
   */
  async listAddresses(accountId: string, options?: {
    limit?: number;
    order?: 'asc' | 'desc';
    starting_after?: string;
    ending_before?: string;
  }): Promise<PaginatedResponse<Address>> {
    return this.client.get<PaginatedResponse<Address>>(`/v2/accounts/${accountId}/addresses`, options as Record<string, string | number>);
  }

  /**
   * Get address by ID
   */
  async getAddress(accountId: string, addressId: string): Promise<{ data: Address }> {
    return this.client.get<{ data: Address }>(`/v2/accounts/${accountId}/addresses/${addressId}`);
  }

  /**
   * Create new address for an account
   */
  async createAddress(accountId: string, name?: string): Promise<{ data: Address }> {
    return this.client.post<{ data: Address }>(`/v2/accounts/${accountId}/addresses`, name ? { name } : {});
  }

  // ============================================
  // Transactions API
  // ============================================

  /**
   * List transactions for an account
   */
  async listTransactions(accountId: string, options?: {
    limit?: number;
    order?: 'asc' | 'desc';
    starting_after?: string;
    ending_before?: string;
  }): Promise<PaginatedResponse<Transaction>> {
    return this.client.get<PaginatedResponse<Transaction>>(`/v2/accounts/${accountId}/transactions`, options as Record<string, string | number>);
  }

  /**
   * Get transaction by ID
   */
  async getTransaction(accountId: string, transactionId: string): Promise<{ data: Transaction }> {
    return this.client.get<{ data: Transaction }>(`/v2/accounts/${accountId}/transactions/${transactionId}`);
  }

  /**
   * Send money
   */
  async sendMoney(accountId: string, request: SendMoneyRequest): Promise<{ data: Transaction }> {
    return this.client.post<{ data: Transaction }>(`/v2/accounts/${accountId}/transactions`, request);
  }

  /**
   * Request money
   */
  async requestMoney(accountId: string, request: {
    type: 'request';
    to: string;
    amount: string;
    currency: string;
    description?: string;
  }): Promise<{ data: Transaction }> {
    return this.client.post<{ data: Transaction }>(`/v2/accounts/${accountId}/transactions`, request);
  }

  /**
   * Complete request money
   */
  async completeRequest(accountId: string, transactionId: string): Promise<void> {
    await this.client.post<void>(`/v2/accounts/${accountId}/transactions/${transactionId}/complete`, {});
  }

  /**
   * Re-send request money
   */
  async resendRequest(accountId: string, transactionId: string): Promise<void> {
    await this.client.post<void>(`/v2/accounts/${accountId}/transactions/${transactionId}/resend`, {});
  }

  /**
   * Cancel request money
   */
  async cancelRequest(accountId: string, transactionId: string): Promise<void> {
    await this.client.delete<void>(`/v2/accounts/${accountId}/transactions/${transactionId}`);
  }

  // ============================================
  // Prices API
  // ============================================

  /**
   * Get spot price for a currency pair
   */
  async getSpotPrice(currencyPair: string, options?: { date?: string }): Promise<SpotPrice> {
    return this.client.get<SpotPrice>(`/v2/prices/${currencyPair}/spot`, options as Record<string, string>);
  }

  /**
   * Get buy price for a currency pair
   */
  async getBuyPrice(currencyPair: string): Promise<BuyPrice> {
    return this.client.get<BuyPrice>(`/v2/prices/${currencyPair}/buy`);
  }

  /**
   * Get sell price for a currency pair
   */
  async getSellPrice(currencyPair: string): Promise<SellPrice> {
    return this.client.get<SellPrice>(`/v2/prices/${currencyPair}/sell`);
  }

  // ============================================
  // Exchange Rates API
  // ============================================

  /**
   * Get exchange rates
   */
  async getExchangeRates(currency?: string): Promise<ExchangeRatesResponse> {
    const params = currency ? { currency } : undefined;
    return this.client.get<ExchangeRatesResponse>('/v2/exchange-rates', params);
  }

  // ============================================
  // Currencies API
  // ============================================

  /**
   * Get supported currencies
   */
  async getCurrencies(): Promise<CurrenciesResponse> {
    return this.client.get<CurrenciesResponse>('/v2/currencies');
  }

  // ============================================
  // Time API
  // ============================================

  /**
   * Get current server time
   */
  async getTime(): Promise<TimeResponse> {
    return this.client.get<TimeResponse>('/v2/time');
  }
}

export { CoinbaseClient } from './client';
