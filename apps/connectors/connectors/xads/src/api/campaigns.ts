import type { XAdsClient } from './client';
import type {
  Campaign,
  CreateCampaignParams,
  UpdateCampaignParams,
  ListResponse,
  PaginationParams,
} from '../types';

/**
 * Campaigns API
 */
export class CampaignsApi {
  constructor(private client: XAdsClient) {}

  /**
   * List all campaigns for an account
   */
  async list(
    accountId: string,
    params?: PaginationParams & {
      campaign_ids?: string[];
      funding_instrument_ids?: string[];
    }
  ): Promise<ListResponse<Campaign>> {
    return this.client.get<ListResponse<Campaign>>(`/accounts/${accountId}/campaigns`, {
      cursor: params?.cursor,
      count: params?.count,
      sort_by: params?.sort_by?.join(','),
      with_deleted: params?.with_deleted,
      with_total_count: params?.with_total_count,
      campaign_ids: params?.campaign_ids?.join(','),
      funding_instrument_ids: params?.funding_instrument_ids?.join(','),
    });
  }

  /**
   * Get a specific campaign
   */
  async get(
    accountId: string,
    campaignId: string,
    withDeleted?: boolean
  ): Promise<{ data: Campaign }> {
    return this.client.get<{ data: Campaign }>(
      `/accounts/${accountId}/campaigns/${campaignId}`,
      { with_deleted: withDeleted }
    );
  }

  /**
   * Create a new campaign
   */
  async create(accountId: string, params: CreateCampaignParams): Promise<{ data: Campaign }> {
    return this.client.post<{ data: Campaign }>(`/accounts/${accountId}/campaigns`, {
      name: params.name,
      funding_instrument_id: params.funding_instrument_id,
      daily_budget_amount_local_micro: params.daily_budget_amount_local_micro,
      total_budget_amount_local_micro: params.total_budget_amount_local_micro,
      start_time: params.start_time,
      end_time: params.end_time,
      entity_status: params.entity_status || 'PAUSED',
      standard_delivery: params.standard_delivery,
      purchase_order_number: params.purchase_order_number,
    });
  }

  /**
   * Update a campaign
   */
  async update(
    accountId: string,
    campaignId: string,
    params: UpdateCampaignParams
  ): Promise<{ data: Campaign }> {
    return this.client.put<{ data: Campaign }>(
      `/accounts/${accountId}/campaigns/${campaignId}`,
      {
        name: params.name,
        daily_budget_amount_local_micro: params.daily_budget_amount_local_micro,
        total_budget_amount_local_micro: params.total_budget_amount_local_micro,
        start_time: params.start_time,
        end_time: params.end_time,
        entity_status: params.entity_status,
        standard_delivery: params.standard_delivery,
        purchase_order_number: params.purchase_order_number,
      }
    );
  }

  /**
   * Delete (soft delete) a campaign
   */
  async delete(accountId: string, campaignId: string): Promise<{ data: Campaign }> {
    return this.client.delete<{ data: Campaign }>(
      `/accounts/${accountId}/campaigns/${campaignId}`
    );
  }

  /**
   * Pause a campaign
   */
  async pause(accountId: string, campaignId: string): Promise<{ data: Campaign }> {
    return this.update(accountId, campaignId, { entity_status: 'PAUSED' });
  }

  /**
   * Activate a campaign
   */
  async activate(accountId: string, campaignId: string): Promise<{ data: Campaign }> {
    return this.update(accountId, campaignId, { entity_status: 'ACTIVE' });
  }
}
