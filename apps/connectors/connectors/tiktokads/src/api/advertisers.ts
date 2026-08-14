import type { TikTokAdsClient } from './client';
import type { Advertiser, PaginatedData } from '../types';

export class AdvertisersApi {
  constructor(private readonly client: TikTokAdsClient) {}

  async list(params?: { app_id?: string; page?: number; page_size?: number }): Promise<PaginatedData<Advertiser>> {
    return this.client.get<PaginatedData<Advertiser>>('/oauth2/advertiser/get/', {
      app_id: params?.app_id,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  async get(advertiserId: string, fields?: string[]): Promise<Advertiser> {
    const response = await this.client.get<{ list: Advertiser[] }>('/advertiser/info/', {
      advertiser_ids: [advertiserId],
      fields,
    });
    if (!response.list?.length) {
      throw new Error(`Advertiser ${advertiserId} not found`);
    }
    return response.list[0];
  }
}
