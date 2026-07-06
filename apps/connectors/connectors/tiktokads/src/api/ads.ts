import type { TikTokAdsClient } from './client';
import type { Ad, AdListParams, PaginatedData } from '../types';

const DEFAULT_AD_FIELDS = [
  'ad_id',
  'ad_name',
  'adgroup_id',
  'campaign_id',
  'status',
  'ad_format',
  'call_to_action',
  'landing_page_url',
  'image_ids',
  'video_id',
  'create_time',
  'modify_time',
  'operation_status',
];

export class AdsApi {
  constructor(private readonly client: TikTokAdsClient) {}

  async list(params: AdListParams): Promise<PaginatedData<Ad>> {
    return this.client.get<PaginatedData<Ad>>('/ad/get/', {
      advertiser_id: params.advertiser_id,
      filtering: params.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params.page,
      page_size: params.page_size,
      fields: params.fields || DEFAULT_AD_FIELDS,
    });
  }

  async get(advertiserId: string, adId: string): Promise<Ad> {
    const response = await this.list({
      advertiser_id: advertiserId,
      filtering: { ad_ids: [adId] },
    });
    if (!response.list?.length) {
      throw new Error(`Ad ${adId} not found`);
    }
    return response.list[0];
  }

  async create(params: Record<string, unknown>): Promise<{ ad_id: string }> {
    return this.client.post<{ ad_id: string }>('/ad/create/', params);
  }

  async update(params: Record<string, unknown>): Promise<{ ad_id: string }> {
    return this.client.post<{ ad_id: string }>('/ad/update/', params);
  }

  async delete(advertiserId: string, adIds: string[]): Promise<{ ad_ids: string[] }> {
    return this.client.post<{ ad_ids: string[] }>('/ad/delete/', {
      advertiser_id: advertiserId,
      ad_ids: adIds,
    });
  }
}
