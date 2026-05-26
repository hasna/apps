import { ClickBankClient } from './client';
import type {
  QuickstatsAccount,
  QuickstatsData,
  QuickstatsCount,
  QuickstatsParams,
} from '../types';

interface AccountsResponse {
  account?: QuickstatsAccount | QuickstatsAccount[];
}

interface QuickstatsListResponse {
  quickstatsData?: QuickstatsData[];
  _hasMore?: boolean;
}

export class QuickstatsApi {
  constructor(private readonly client: ClickBankClient) {}

  /**
   * Get the XML schema for quickstats results
   */
  async getSchema(): Promise<string> {
    return this.client.get<string>('/quickstats/schema', undefined, 'xml');
  }

  /**
   * Get list of accounts the API user has read access to
   */
  async getAccounts(): Promise<QuickstatsAccount[]> {
    const response = await this.client.get<AccountsResponse>('/quickstats/accounts');
    if (!response.account) return [];
    return Array.isArray(response.account) ? response.account : [response.account];
  }

  /**
   * Get total sale, refund, and chargeback counts for a time period
   */
  async count(params?: Omit<QuickstatsParams, 'page'>): Promise<QuickstatsCount> {
    return this.client.get<QuickstatsCount>(
      '/quickstats/count',
      params as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Get daily sale, refund, and chargeback data for a time period
   */
  async list(params?: QuickstatsParams): Promise<{ data: QuickstatsData[]; hasMore: boolean }> {
    const { page, ...queryParams } = params || {};
    const headers = page ? { page: String(page) } : undefined;

    const response = await this.client.request<QuickstatsListResponse>('/quickstats/list', {
      method: 'GET',
      params: queryParams as Record<string, string | number | boolean | undefined>,
      headers,
    });

    const data = response.quickstatsData || [];
    return {
      data: Array.isArray(data) ? data : [data],
      hasMore: !!response._hasMore,
    };
  }

  /**
   * Get quick summary stats for today
   */
  async getToday(account?: string): Promise<QuickstatsCount> {
    const today = new Date().toISOString().split('T')[0];
    return this.count({
      account,
      startDate: today,
      endDate: today,
    });
  }

  /**
   * Get quick summary stats for the last N days
   */
  async getLastDays(days: number, account?: string): Promise<QuickstatsCount> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.count({
      account,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    });
  }

  /**
   * Get daily stats for a date range
   */
  async getDailyStats(
    startDate: string,
    endDate: string,
    account?: string
  ): Promise<QuickstatsData[]> {
    const result: QuickstatsData[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.list({
        account,
        startDate,
        endDate,
        page,
      });

      result.push(...response.data);
      hasMore = response.hasMore;
      page++;
    }

    return result;
  }
}
