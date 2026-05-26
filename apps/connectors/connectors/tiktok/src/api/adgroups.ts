import type { TikTokClient } from './client';
import type {
  AdGroup,
  AdGroupCreateParams,
  AdGroupUpdateParams,
  AdGroupListParams,
  PaginatedData,
  OperationStatus,
} from '../types';

/**
 * TikTok Ad Groups API
 * Create, read, update, and delete ad groups
 */
export class AdGroupsApi {
  constructor(private readonly client: TikTokClient) {}

  /**
   * List ad groups
   * GET /adgroup/get/
   */
  async list(params: AdGroupListParams): Promise<PaginatedData<AdGroup>> {
    return this.client.get<PaginatedData<AdGroup>>('/adgroup/get/', {
      advertiser_id: params.advertiser_id,
      filtering: params.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params.page,
      page_size: params.page_size,
      fields: params.fields,
    });
  }

  /**
   * Get a single ad group by ID
   */
  async get(advertiserId: string, adgroupId: string): Promise<AdGroup> {
    const response = await this.list({
      advertiser_id: advertiserId,
      filtering: { adgroup_ids: [adgroupId] },
    });
    if (!response.list || response.list.length === 0) {
      throw new Error(`Ad group ${adgroupId} not found`);
    }
    return response.list[0];
  }

  /**
   * Create a new ad group
   * POST /adgroup/create/
   */
  async create(params: AdGroupCreateParams): Promise<{ adgroup_id: string }> {
    return this.client.post<{ adgroup_id: string }>('/adgroup/create/', params);
  }

  /**
   * Update an existing ad group
   * POST /adgroup/update/
   */
  async update(params: AdGroupUpdateParams): Promise<{ adgroup_id: string }> {
    return this.client.post<{ adgroup_id: string }>('/adgroup/update/', params);
  }

  /**
   * Delete ad groups
   * POST /adgroup/delete/
   */
  async delete(advertiserId: string, adgroupIds: string[]): Promise<{ adgroup_ids: string[] }> {
    return this.client.post<{ adgroup_ids: string[] }>('/adgroup/delete/', {
      advertiser_id: advertiserId,
      adgroup_ids: adgroupIds,
    });
  }

  /**
   * Update ad group status (enable/disable)
   * POST /adgroup/status/update/
   */
  async updateStatus(
    advertiserId: string,
    adgroupIds: string[],
    operationStatus: OperationStatus
  ): Promise<{ adgroup_ids: string[] }> {
    return this.client.post<{ adgroup_ids: string[] }>('/adgroup/status/update/', {
      advertiser_id: advertiserId,
      adgroup_ids: adgroupIds,
      operation_status: operationStatus,
    });
  }

  /**
   * Enable ad groups
   */
  async enable(advertiserId: string, adgroupIds: string[]): Promise<{ adgroup_ids: string[] }> {
    return this.updateStatus(advertiserId, adgroupIds, 'ENABLE');
  }

  /**
   * Disable ad groups
   */
  async disable(advertiserId: string, adgroupIds: string[]): Promise<{ adgroup_ids: string[] }> {
    return this.updateStatus(advertiserId, adgroupIds, 'DISABLE');
  }

  /**
   * Update ad group budget
   * POST /adgroup/budget/update/
   */
  async updateBudget(
    advertiserId: string,
    adgroupId: string,
    budget: number
  ): Promise<{ adgroup_id: string }> {
    return this.client.post<{ adgroup_id: string }>('/adgroup/budget/update/', {
      advertiser_id: advertiserId,
      adgroup_id: adgroupId,
      budget,
    });
  }

  /**
   * Get suggested bid
   * GET /adgroup/suggest_bid/
   */
  async getSuggestedBid(params: {
    advertiser_id: string;
    objective_type: string;
    optimization_goal: string;
    billing_event?: string;
    location_ids?: string[];
    placements?: string[];
  }): Promise<{
    suggested_bid: number;
    suggested_bid_high: number;
    suggested_bid_low: number;
  }> {
    return this.client.get('/adgroup/suggest_bid/', {
      advertiser_id: params.advertiser_id,
      objective_type: params.objective_type,
      optimization_goal: params.optimization_goal,
      billing_event: params.billing_event,
      location_ids: params.location_ids,
      placements: params.placements,
    });
  }
}
