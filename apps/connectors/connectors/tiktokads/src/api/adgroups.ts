import type { TikTokAdsClient } from './client';
import type { AdGroup, AdGroupListParams, PaginatedData } from '../types';

const DEFAULT_ADGROUP_FIELDS = [
  'adgroup_id',
  'adgroup_name',
  'campaign_id',
  'status',
  'optimization_goal',
  'bid_type',
  'bid_price',
  'budget',
  'budget_mode',
  'schedule_start_time',
  'schedule_end_time',
  'create_time',
  'modify_time',
  'operation_status',
];

export class AdGroupsApi {
  constructor(private readonly client: TikTokAdsClient) {}

  async list(params: AdGroupListParams): Promise<PaginatedData<AdGroup>> {
    return this.client.get<PaginatedData<AdGroup>>('/adgroup/get/', {
      advertiser_id: params.advertiser_id,
      filtering: params.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params.page,
      page_size: params.page_size,
      fields: params.fields || DEFAULT_ADGROUP_FIELDS,
    });
  }

  async get(advertiserId: string, adGroupId: string): Promise<AdGroup> {
    const response = await this.list({
      advertiser_id: advertiserId,
      filtering: { adgroup_ids: [adGroupId] },
    });
    if (!response.list?.length) {
      throw new Error(`Ad group ${adGroupId} not found`);
    }
    return response.list[0];
  }

  async create(params: Record<string, unknown>): Promise<{ adgroup_id: string }> {
    return this.client.post<{ adgroup_id: string }>('/adgroup/create/', params);
  }

  async update(params: Record<string, unknown>): Promise<{ adgroup_id: string }> {
    return this.client.post<{ adgroup_id: string }>('/adgroup/update/', params);
  }

  async delete(advertiserId: string, adGroupIds: string[]): Promise<{ adgroup_ids: string[] }> {
    return this.client.post<{ adgroup_ids: string[] }>('/adgroup/delete/', {
      advertiser_id: advertiserId,
      adgroup_ids: adGroupIds,
    });
  }
}
