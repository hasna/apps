import type { TikTokClient } from './client';
import type {
  Campaign,
  CampaignCreateParams,
  CampaignUpdateParams,
  CampaignListParams,
  PaginatedData,
  OperationStatus,
} from '../types';

/**
 * TikTok Campaigns API
 * Create, read, update, and delete campaigns
 */
export class CampaignsApi {
  constructor(private readonly client: TikTokClient) {}

  /**
   * List campaigns
   * GET /campaign/get/
   */
  async list(params: CampaignListParams): Promise<PaginatedData<Campaign>> {
    return this.client.get<PaginatedData<Campaign>>('/campaign/get/', {
      advertiser_id: params.advertiser_id,
      filtering: params.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params.page,
      page_size: params.page_size,
      fields: params.fields,
    });
  }

  /**
   * Get a single campaign by ID
   */
  async get(advertiserId: string, campaignId: string): Promise<Campaign> {
    const response = await this.list({
      advertiser_id: advertiserId,
      filtering: { campaign_ids: [campaignId] },
    });
    if (!response.list || response.list.length === 0) {
      throw new Error(`Campaign ${campaignId} not found`);
    }
    return response.list[0];
  }

  /**
   * Create a new campaign
   * POST /campaign/create/
   */
  async create(params: CampaignCreateParams): Promise<{ campaign_id: string }> {
    return this.client.post<{ campaign_id: string }>('/campaign/create/', params);
  }

  /**
   * Update an existing campaign
   * POST /campaign/update/
   */
  async update(params: CampaignUpdateParams): Promise<{ campaign_id: string }> {
    return this.client.post<{ campaign_id: string }>('/campaign/update/', params);
  }

  /**
   * Delete campaigns
   * POST /campaign/delete/
   */
  async delete(advertiserId: string, campaignIds: string[]): Promise<{ campaign_ids: string[] }> {
    return this.client.post<{ campaign_ids: string[] }>('/campaign/delete/', {
      advertiser_id: advertiserId,
      campaign_ids: campaignIds,
    });
  }

  /**
   * Update campaign status (enable/disable)
   * POST /campaign/status/update/
   */
  async updateStatus(
    advertiserId: string,
    campaignIds: string[],
    operationStatus: OperationStatus
  ): Promise<{ campaign_ids: string[] }> {
    return this.client.post<{ campaign_ids: string[] }>('/campaign/status/update/', {
      advertiser_id: advertiserId,
      campaign_ids: campaignIds,
      operation_status: operationStatus,
    });
  }

  /**
   * Enable campaigns
   */
  async enable(advertiserId: string, campaignIds: string[]): Promise<{ campaign_ids: string[] }> {
    return this.updateStatus(advertiserId, campaignIds, 'ENABLE');
  }

  /**
   * Disable campaigns
   */
  async disable(advertiserId: string, campaignIds: string[]): Promise<{ campaign_ids: string[] }> {
    return this.updateStatus(advertiserId, campaignIds, 'DISABLE');
  }

  /**
   * Create GMV Max Campaign
   * POST /campaign/create/ with campaign_type: GMV_MAX_CAMPAIGN
   */
  async createGmvMax(params: Omit<CampaignCreateParams, 'campaign_type'> & {
    shop_id: string;
    store_authorized_bc_id?: string;
  }): Promise<{ campaign_id: string }> {
    return this.client.post<{ campaign_id: string }>('/campaign/create/', {
      ...params,
      campaign_type: 'GMV_MAX_CAMPAIGN',
    });
  }
}
