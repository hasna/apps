import type { MetaClient } from './client';
import type {
  Campaign,
  CampaignCreateParams,
  CampaignUpdateParams,
  CampaignListParams,
  PaginatedResponse,
  Insights,
  InsightsParams,
} from '../types';
import { formatAdAccountId } from '../utils/config';

const DEFAULT_FIELDS = [
  'id',
  'account_id',
  'name',
  'objective',
  'status',
  'effective_status',
  'bid_strategy',
  'budget_remaining',
  'buying_type',
  'daily_budget',
  'lifetime_budget',
  'spend_cap',
  'special_ad_categories',
  'start_time',
  'stop_time',
  'created_time',
  'updated_time',
];

/**
 * Meta Campaigns API
 * Create and manage ad campaigns
 */
export class CampaignsApi {
  constructor(private readonly client: MetaClient) {}

  /**
   * List campaigns for an ad account
   */
  async list(adAccountId: string, params?: CampaignListParams): Promise<PaginatedResponse<Campaign>> {
    const formattedId = formatAdAccountId(adAccountId);
    const fields = params?.fields || DEFAULT_FIELDS;

    const queryParams: Record<string, string | number | boolean | string[] | undefined> = {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
      before: params?.before,
      date_preset: params?.date_preset,
    };

    if (params?.effective_status) {
      queryParams.effective_status = JSON.stringify(params.effective_status);
    }

    return this.client.get<PaginatedResponse<Campaign>>(`/${formattedId}/campaigns`, queryParams);
  }

  /**
   * Get a single campaign by ID
   */
  async get(campaignId: string, fields?: string[]): Promise<Campaign> {
    return this.client.get<Campaign>(`/${campaignId}`, {
      fields: (fields || DEFAULT_FIELDS).join(','),
    });
  }

  /**
   * Create a new campaign
   */
  async create(adAccountId: string, params: CampaignCreateParams): Promise<{ id: string }> {
    const formattedId = formatAdAccountId(adAccountId);
    return this.client.post<{ id: string }>(`/${formattedId}/campaigns`, params as unknown as Record<string, unknown>);
  }

  /**
   * Update a campaign
   */
  async update(campaignId: string, params: CampaignUpdateParams): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/${campaignId}`, params as Record<string, unknown>);
  }

  /**
   * Delete a campaign (sets status to DELETED)
   */
  async delete(campaignId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/${campaignId}`);
  }

  /**
   * Pause a campaign
   */
  async pause(campaignId: string): Promise<{ success: boolean }> {
    return this.update(campaignId, { status: 'PAUSED' });
  }

  /**
   * Activate a campaign
   */
  async activate(campaignId: string): Promise<{ success: boolean }> {
    return this.update(campaignId, { status: 'ACTIVE' });
  }

  /**
   * Archive a campaign
   */
  async archive(campaignId: string): Promise<{ success: boolean }> {
    return this.update(campaignId, { status: 'ARCHIVED' });
  }

  /**
   * Get campaign insights/metrics
   */
  async getInsights(campaignId: string, params?: InsightsParams): Promise<PaginatedResponse<Insights>> {
    const defaultFields = [
      'campaign_id',
      'campaign_name',
      'impressions',
      'clicks',
      'spend',
      'reach',
      'cpc',
      'cpm',
      'ctr',
      'actions',
      'conversions',
      'date_start',
      'date_stop',
    ];

    const queryParams: Record<string, string | number | boolean | string[] | undefined> = {
      fields: (params?.fields || defaultFields).join(','),
      date_preset: params?.date_preset,
      time_increment: params?.time_increment?.toString(),
      limit: params?.limit,
      after: params?.after,
    };

    if (params?.time_range) {
      queryParams.time_range = JSON.stringify(params.time_range);
    }

    if (params?.breakdowns) {
      queryParams.breakdowns = params.breakdowns.join(',');
    }

    if (params?.action_breakdowns) {
      queryParams.action_breakdowns = params.action_breakdowns.join(',');
    }

    if (params?.filtering) {
      queryParams.filtering = JSON.stringify(params.filtering);
    }

    return this.client.get<PaginatedResponse<Insights>>(`/${campaignId}/insights`, queryParams);
  }

  /**
   * Get ad sets within a campaign
   */
  async getAdSets(campaignId: string, params?: { fields?: string[]; limit?: number; after?: string }): Promise<PaginatedResponse<{ id: string; name: string; status: string }>> {
    const defaultFields = ['id', 'name', 'status', 'effective_status', 'daily_budget', 'lifetime_budget'];
    return this.client.get<PaginatedResponse<{ id: string; name: string; status: string }>>(`/${campaignId}/adsets`, {
      fields: (params?.fields || defaultFields).join(','),
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Get ads within a campaign
   */
  async getAds(campaignId: string, params?: { fields?: string[]; limit?: number; after?: string }): Promise<PaginatedResponse<{ id: string; name: string; status: string }>> {
    const defaultFields = ['id', 'name', 'status', 'effective_status', 'creative'];
    return this.client.get<PaginatedResponse<{ id: string; name: string; status: string }>>(`/${campaignId}/ads`, {
      fields: (params?.fields || defaultFields).join(','),
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Duplicate a campaign
   */
  async duplicate(campaignId: string, params: { deep_copy?: boolean; status_option?: 'ACTIVE' | 'PAUSED' | 'INHERITED' }): Promise<{ copied_campaign_id: string }> {
    return this.client.post<{ copied_campaign_id: string }>(`/${campaignId}/copies`, params as Record<string, unknown>);
  }
}
