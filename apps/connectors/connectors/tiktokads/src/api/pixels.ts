import type { TikTokAdsClient } from './client';
import type { PaginatedData, Pixel } from '../types';

export class PixelsApi {
  constructor(private readonly client: TikTokAdsClient) {}

  async list(
    advertiserId: string,
    params?: { page?: number; page_size?: number },
  ): Promise<PaginatedData<Pixel>> {
    return this.client.get<PaginatedData<Pixel>>('/pixel/list/', {
      advertiser_id: advertiserId,
      page: params?.page,
      page_size: params?.page_size,
    });
  }
}
