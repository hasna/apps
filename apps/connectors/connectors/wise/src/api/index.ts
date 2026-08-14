import type {
  WiseConfig,
  WiseProfile,
  Balance,
  Quote,
  CreateQuoteRequest,
  Recipient,
  CreateRecipientRequest,
  Transfer,
  CreateTransferRequest,
  FundTransferRequest,
  ExchangeRate,
  Currency,
} from '../types';
import { WiseClient } from './client';

/**
 * Wise Connector
 * International money transfers, multi-currency accounts, and exchange rates
 */
export class Wise {
  private readonly client: WiseClient;

  constructor(config: WiseConfig) {
    this.client = new WiseClient(config);
  }

  /**
   * Create a client from environment variables
   * Looks for WISE_API_KEY
   */
  static fromEnv(): Wise {
    const apiKey = process.env.WISE_API_KEY;
    const baseUrl = process.env.WISE_BASE_URL;

    if (!apiKey) {
      throw new Error('WISE_API_KEY environment variable is required');
    }
    return new Wise({ apiKey, baseUrl });
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
  getClient(): WiseClient {
    return this.client;
  }

  // ============================================
  // Profiles API
  // ============================================

  /**
   * Get all profiles for the authenticated user
   */
  async listProfiles(): Promise<WiseProfile[]> {
    return this.client.get<WiseProfile[]>('/v1/profiles');
  }

  /**
   * Get a profile by ID
   */
  async getProfile(profileId: number): Promise<WiseProfile> {
    return this.client.get<WiseProfile>(`/v1/profiles/${profileId}`);
  }

  // ============================================
  // Balances API
  // ============================================

  /**
   * List all balances for a profile
   */
  async listBalances(profileId: number, types?: string[]): Promise<Balance[]> {
    const params: Record<string, string> = {};
    if (types && types.length > 0) {
      params.types = types.join(',');
    }
    return this.client.get<Balance[]>(`/v4/profiles/${profileId}/balances`, params);
  }

  /**
   * Get a single balance by ID
   */
  async getBalance(profileId: number, balanceId: number): Promise<Balance> {
    return this.client.get<Balance>(`/v4/profiles/${profileId}/balances/${balanceId}`);
  }

  /**
   * Get balance by currency
   */
  async getBalanceByCurrency(profileId: number, currency: string): Promise<Balance | undefined> {
    const balances = await this.listBalances(profileId);
    return balances.find(b => b.currency === currency);
  }

  // ============================================
  // Quotes API
  // ============================================

  /**
   * Create a quote
   */
  async createQuote(profileId: number, quote: CreateQuoteRequest): Promise<Quote> {
    return this.client.post<Quote>(`/v3/profiles/${profileId}/quotes`, quote);
  }

  /**
   * Get a quote by ID
   */
  async getQuote(profileId: number, quoteId: string): Promise<Quote> {
    return this.client.get<Quote>(`/v3/profiles/${profileId}/quotes/${quoteId}`);
  }

  // ============================================
  // Recipients (Accounts) API
  // ============================================

  /**
   * List all recipients for a profile
   */
  async listRecipients(profileId: number, options?: {
    currency?: string;
    size?: number;
    seekPosition?: number;
  }): Promise<Recipient[]> {
    const params: Record<string, string | number> = { profile: profileId };
    if (options?.currency) params.currency = options.currency;
    if (options?.size) params.size = options.size;
    if (options?.seekPosition) params.seekPosition = options.seekPosition;
    return this.client.get<Recipient[]>('/v1/accounts', params);
  }

  /**
   * Get a recipient by ID
   */
  async getRecipient(recipientId: number): Promise<Recipient> {
    return this.client.get<Recipient>(`/v1/accounts/${recipientId}`);
  }

  /**
   * Create a new recipient
   */
  async createRecipient(recipient: CreateRecipientRequest): Promise<Recipient> {
    return this.client.post<Recipient>('/v1/accounts', recipient);
  }

  /**
   * Delete a recipient
   */
  async deleteRecipient(recipientId: number): Promise<void> {
    await this.client.delete<void>(`/v1/accounts/${recipientId}`);
  }

  /**
   * Get required fields for a recipient type
   */
  async getRecipientRequirements(options: {
    source: string;
    target: string;
    sourceAmount?: number;
  }): Promise<unknown[]> {
    return this.client.get<unknown[]>('/v1/account-requirements', options as Record<string, string | number>);
  }

  // ============================================
  // Transfers API
  // ============================================

  /**
   * List all transfers for a profile
   */
  async listTransfers(profileId: number, options?: {
    offset?: number;
    limit?: number;
    status?: string;
    createdDateStart?: string;
    createdDateEnd?: string;
  }): Promise<Transfer[]> {
    const params: Record<string, string | number> = { profile: profileId };
    if (options?.offset) params.offset = options.offset;
    if (options?.limit) params.limit = options.limit;
    if (options?.status) params.status = options.status;
    if (options?.createdDateStart) params.createdDateStart = options.createdDateStart;
    if (options?.createdDateEnd) params.createdDateEnd = options.createdDateEnd;
    return this.client.get<Transfer[]>('/v1/transfers', params);
  }

  /**
   * Get a transfer by ID
   */
  async getTransfer(transferId: number): Promise<Transfer> {
    return this.client.get<Transfer>(`/v1/transfers/${transferId}`);
  }

  /**
   * Create a transfer
   */
  async createTransfer(transfer: CreateTransferRequest): Promise<Transfer> {
    return this.client.post<Transfer>('/v1/transfers', transfer);
  }

  /**
   * Fund a transfer (pay from balance)
   */
  async fundTransfer(profileId: number, transferId: number, options: FundTransferRequest = { type: 'BALANCE' }): Promise<{ status: string; errorCode?: string }> {
    return this.client.post<{ status: string; errorCode?: string }>(
      `/v3/profiles/${profileId}/transfers/${transferId}/payments`,
      options
    );
  }

  /**
   * Cancel a transfer
   */
  async cancelTransfer(transferId: number): Promise<Transfer> {
    return this.client.put<Transfer>(`/v1/transfers/${transferId}/cancel`);
  }

  /**
   * Get transfer issues
   */
  async getTransferIssues(transferId: number): Promise<unknown[]> {
    return this.client.get<unknown[]>(`/v1/transfers/${transferId}/issues`);
  }

  // ============================================
  // Exchange Rates API
  // ============================================

  /**
   * Get live exchange rate
   */
  async getExchangeRate(source: string, target: string): Promise<ExchangeRate[]> {
    return this.client.get<ExchangeRate[]>('/v1/rates', { source, target });
  }

  /**
   * Get historical exchange rates
   */
  async getHistoricalRates(source: string, target: string, options?: {
    from?: string;
    to?: string;
    group?: 'day' | 'hour' | 'minute';
  }): Promise<ExchangeRate[]> {
    const params: Record<string, string> = { source, target };
    if (options?.from) params.from = options.from;
    if (options?.to) params.to = options.to;
    if (options?.group) params.group = options.group;
    return this.client.get<ExchangeRate[]>('/v1/rates', params);
  }

  // ============================================
  // Currencies API
  // ============================================

  /**
   * Get available currencies
   */
  async listCurrencies(): Promise<Currency[]> {
    return this.client.get<Currency[]>('/v1/currencies');
  }

  /**
   * Get currency pairs for a source currency
   */
  async getCurrencyPairs(source: string): Promise<{ sourceCurrency: string; targetCurrency: string }[]> {
    return this.client.get<{ sourceCurrency: string; targetCurrency: string }[]>('/v1/currency-pairs', { source });
  }
}

export { WiseClient } from './client';
