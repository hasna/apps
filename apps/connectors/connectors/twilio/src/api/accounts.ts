import type { TwilioClient } from './client';
import type {
  Account,
  AccountListResponse,
  CreateSubAccountParams,
  UpdateAccountParams,
  Balance,
} from '../types';

/**
 * Twilio Accounts API
 * Get account info, manage subaccounts, check balance
 */
export class AccountsApi {
  constructor(private readonly client: TwilioClient) {}

  /**
   * Get the current account
   */
  async get(): Promise<Account> {
    return this.client.get<Account>(
      `/Accounts/{AccountSid}.json`
    );
  }

  /**
   * Get a specific account by SID
   */
  async getBySid(accountSid: string): Promise<Account> {
    return this.client.get<Account>(
      `/Accounts/${accountSid}.json`
    );
  }

  /**
   * Update the current account
   */
  async update(params: UpdateAccountParams): Promise<Account> {
    return this.client.post<Account>(
      `/Accounts/{AccountSid}.json`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * Update a specific account by SID
   */
  async updateBySid(accountSid: string, params: UpdateAccountParams): Promise<Account> {
    return this.client.post<Account>(
      `/Accounts/${accountSid}.json`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * List all accounts (including subaccounts)
   */
  async list(params?: { FriendlyName?: string; Status?: string; PageSize?: number; Page?: number }): Promise<AccountListResponse> {
    return this.client.get<AccountListResponse>(
      `/Accounts.json`,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Create a subaccount
   */
  async createSubAccount(params?: CreateSubAccountParams): Promise<Account> {
    return this.client.post<Account>(
      `/Accounts.json`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * Suspend a subaccount
   */
  async suspend(accountSid: string): Promise<Account> {
    return this.updateBySid(accountSid, { Status: 'suspended' });
  }

  /**
   * Activate a subaccount
   */
  async activate(accountSid: string): Promise<Account> {
    return this.updateBySid(accountSid, { Status: 'active' });
  }

  /**
   * Close a subaccount (permanent)
   */
  async close(accountSid: string): Promise<Account> {
    return this.updateBySid(accountSid, { Status: 'closed' });
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<Balance> {
    return this.client.get<Balance>(
      `/Accounts/{AccountSid}/Balance.json`
    );
  }

  /**
   * Get balance for a specific account
   */
  async getBalanceBySid(accountSid: string): Promise<Balance> {
    return this.client.get<Balance>(
      `/Accounts/${accountSid}/Balance.json`
    );
  }

  // ============================================
  // Usage Records
  // ============================================

  /**
   * Get usage records
   */
  async getUsage(params?: {
    Category?: string;
    StartDate?: string;
    EndDate?: string;
    IncludeSubaccounts?: boolean;
    PageSize?: number;
    Page?: number;
  }): Promise<{
    usage_records: Array<{
      account_sid: string;
      api_version: string;
      as_of: string;
      category: string;
      count: string;
      count_unit: string;
      description: string;
      end_date: string;
      price: string;
      price_unit: string;
      start_date: string;
      subresource_uris: Record<string, string>;
      uri: string;
      usage: string;
      usage_unit: string;
    }>;
    end: number;
    first_page_uri: string;
    next_page_uri: string | null;
    page: number;
    page_size: number;
    previous_page_uri: string | null;
    start: number;
    uri: string;
  }> {
    return this.client.get(
      `/Accounts/{AccountSid}/Usage/Records.json`,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Get daily usage records
   */
  async getDailyUsage(params?: {
    Category?: string;
    StartDate?: string;
    EndDate?: string;
    IncludeSubaccounts?: boolean;
    PageSize?: number;
    Page?: number;
  }): Promise<{
    usage_records: Array<{
      account_sid: string;
      category: string;
      count: string;
      description: string;
      end_date: string;
      price: string;
      start_date: string;
      usage: string;
    }>;
    end: number;
    next_page_uri: string | null;
    page: number;
    page_size: number;
    start: number;
  }> {
    return this.client.get(
      `/Accounts/{AccountSid}/Usage/Records/Daily.json`,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Get monthly usage records
   */
  async getMonthlyUsage(params?: {
    Category?: string;
    StartDate?: string;
    EndDate?: string;
    IncludeSubaccounts?: boolean;
    PageSize?: number;
    Page?: number;
  }): Promise<{
    usage_records: Array<{
      account_sid: string;
      category: string;
      count: string;
      description: string;
      end_date: string;
      price: string;
      start_date: string;
      usage: string;
    }>;
    end: number;
    next_page_uri: string | null;
    page: number;
    page_size: number;
    start: number;
  }> {
    return this.client.get(
      `/Accounts/{AccountSid}/Usage/Records/Monthly.json`,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Get today's usage
   */
  async getTodayUsage(category?: string): Promise<{
    usage_records: Array<{
      account_sid: string;
      category: string;
      count: string;
      description: string;
      end_date: string;
      price: string;
      start_date: string;
      usage: string;
    }>;
  }> {
    return this.client.get(
      `/Accounts/{AccountSid}/Usage/Records/Today.json`,
      category ? { Category: category } : undefined
    );
  }

  /**
   * Get yesterday's usage
   */
  async getYesterdayUsage(category?: string): Promise<{
    usage_records: Array<{
      account_sid: string;
      category: string;
      count: string;
      description: string;
      end_date: string;
      price: string;
      start_date: string;
      usage: string;
    }>;
  }> {
    return this.client.get(
      `/Accounts/{AccountSid}/Usage/Records/Yesterday.json`,
      category ? { Category: category } : undefined
    );
  }

  /**
   * Get this month's usage
   */
  async getThisMonthUsage(category?: string): Promise<{
    usage_records: Array<{
      account_sid: string;
      category: string;
      count: string;
      description: string;
      end_date: string;
      price: string;
      start_date: string;
      usage: string;
    }>;
  }> {
    return this.client.get(
      `/Accounts/{AccountSid}/Usage/Records/ThisMonth.json`,
      category ? { Category: category } : undefined
    );
  }

  /**
   * Get last month's usage
   */
  async getLastMonthUsage(category?: string): Promise<{
    usage_records: Array<{
      account_sid: string;
      category: string;
      count: string;
      description: string;
      end_date: string;
      price: string;
      start_date: string;
      usage: string;
    }>;
  }> {
    return this.client.get(
      `/Accounts/{AccountSid}/Usage/Records/LastMonth.json`,
      category ? { Category: category } : undefined
    );
  }

  // ============================================
  // Convenience Methods
  // ============================================

  /**
   * List all subaccounts
   */
  async listSubAccounts(params?: { FriendlyName?: string; Status?: string; PageSize?: number; Page?: number }): Promise<AccountListResponse> {
    return this.list(params);
  }

  /**
   * Get account friendly name
   */
  async getFriendlyName(): Promise<string> {
    const account = await this.get();
    return account.friendly_name;
  }

  /**
   * Update account friendly name
   */
  async setFriendlyName(friendlyName: string): Promise<Account> {
    return this.update({ FriendlyName: friendlyName });
  }

  /**
   * Check if account is active
   */
  async isActive(): Promise<boolean> {
    const account = await this.get();
    return account.status === 'active';
  }

  /**
   * Get account type (Trial or Full)
   */
  async getType(): Promise<'Trial' | 'Full'> {
    const account = await this.get();
    return account.type;
  }
}
