import type { TikTokClient } from './client';
import type { Advertiser, AdvertiserUpdateParams, PaginatedData } from '../types';

/**
 * TikTok Advertisers API
 * Manage advertiser accounts and information
 */
export class AdvertisersApi {
  constructor(private readonly client: TikTokClient) {}

  /**
   * Get advertiser info
   * GET /advertiser/info/
   */
  async get(advertiserId: string, fields?: string[]): Promise<Advertiser> {
    const response = await this.client.get<{ list: Advertiser[] }>('/advertiser/info/', {
      advertiser_ids: [advertiserId],
      fields: fields,
    });
    if (!response.list || response.list.length === 0) {
      throw new Error(`Advertiser ${advertiserId} not found`);
    }
    return response.list[0];
  }

  /**
   * List advertisers under the account
   * GET /oauth2/advertiser/get/
   */
  async list(params?: {
    app_id?: string;
    secret?: string;
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<Advertiser>> {
    return this.client.get<PaginatedData<Advertiser>>('/oauth2/advertiser/get/', {
      app_id: params?.app_id,
      secret: params?.secret,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Update advertiser info
   * POST /advertiser/update/
   */
  async update(params: AdvertiserUpdateParams): Promise<Advertiser> {
    return this.client.post<Advertiser>('/advertiser/update/', params);
  }

  /**
   * Get advertiser balance
   * GET /advertiser/fund/get/
   */
  async getBalance(advertiserId: string): Promise<{
    balance: number;
    cash: number;
    grant: number;
    transfer_in: number;
    transfer_out: number;
  }> {
    const response = await this.client.get<{ list: Array<{
      advertiser_id: string;
      balance: number;
      cash: number;
      grant: number;
      transfer_in: number;
      transfer_out: number;
    }> }>('/advertiser/fund/get/', {
      advertiser_ids: [advertiserId],
    });
    if (!response.list || response.list.length === 0) {
      throw new Error(`Balance for advertiser ${advertiserId} not found`);
    }
    return response.list[0];
  }

  /**
   * Get fund transactions history
   * GET /advertiser/fund/transaction/get/
   */
  async getTransactions(advertiserId: string, params?: {
    start_date?: string;
    end_date?: string;
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<{
    transaction_id: string;
    transaction_type: string;
    amount: number;
    balance: number;
    create_time: string;
    description?: string;
  }>> {
    return this.client.get('/advertiser/fund/transaction/get/', {
      advertiser_id: advertiserId,
      start_date: params?.start_date,
      end_date: params?.end_date,
      page: params?.page,
      page_size: params?.page_size,
    });
  }
}
