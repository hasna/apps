import type { TikTokAdsClient } from './client';
import type {
  Campaign,
  CampaignCreateParams,
  CampaignListParams,
  CampaignUpdateParams,
  PaginatedData,
} from '../types';

const DEFAULT_CAMPAIGN_FIELDS = [
  'campaign_id',
  'campaign_name',
  'campaign_type',
  'status',
  'objective_type',
  'budget_mode',
  'budget',
  'create_time',
  'modify_time',
  'operation_status',
];

export class CampaignsApi {
  constructor(private readonly client: TikTokAdsClient) {}

  async list(params: CampaignListParams): Promise<PaginatedData<Campaign>> {
    return this.client.get<PaginatedData<Campaign>>('/campaign/get/', {
      advertiser_id: params.advertiser_id,
      filtering: params.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params.page,
      page_size: params.page_size,
      fields: params.fields || DEFAULT_CAMPAIGN_FIELDS,
    });
  }

  async get(advertiserId: string, campaignId: string): Promise<Campaign> {
    const response = await this.list({
      advertiser_id: advertiserId,
      filtering: { campaign_ids: [campaignId] },
    });
    if (!response.list?.length) {
      throw new Error(`Campaign ${campaignId} not found`);
    }
    return response.list[0];
  }

  async create(params: CampaignCreateParams): Promise<{ campaign_id: string }> {
    return this.client.post<{ campaign_id: string }>('/campaign/create/', params);
  }

  async update(params: CampaignUpdateParams): Promise<{ campaign_id: string }> {
    return this.client.post<{ campaign_id: string }>('/campaign/update/', params);
  }

  async delete(advertiserId: string, campaignIds: string[]): Promise<{ campaign_ids: string[] }> {
    return this.client.post<{ campaign_ids: string[] }>('/campaign/delete/', {
      advertiser_id: advertiserId,
      campaign_ids: campaignIds,
    });
  }
}
