import type { MetaClient } from './client';
import type {
  AdSet,
  AdSetCreateParams,
  AdSetUpdateParams,
  AdSetListParams,
  PaginatedResponse,
  Insights,
  InsightsParams,
} from '../types';
import { formatAdAccountId } from '../utils/config';

const DEFAULT_FIELDS = [
  'id',
  'account_id',
  'campaign_id',
  'name',
  'status',
  'effective_status',
  'optimization_goal',
  'billing_event',
  'bid_amount',
  'bid_strategy',
  'daily_budget',
  'lifetime_budget',
  'budget_remaining',
  'targeting',
  'start_time',
  'end_time',
  'created_time',
  'updated_time',
];

/**
 * Meta Ad Sets API
 * Create and manage ad sets with targeting, budgets, and scheduling
 */
export class AdSetsApi {
  constructor(private readonly client: MetaClient) {}

  /**
   * List ad sets for an ad account
   */
  async list(adAccountId: string, params?: AdSetListParams): Promise<PaginatedResponse<AdSet>> {
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

    return this.client.get<PaginatedResponse<AdSet>>(`/${formattedId}/adsets`, queryParams);
  }

  /**
   * List ad sets for a campaign
   */
  async listByCampaign(campaignId: string, params?: AdSetListParams): Promise<PaginatedResponse<AdSet>> {
    const fields = params?.fields || DEFAULT_FIELDS;

    const queryParams: Record<string, string | number | boolean | string[] | undefined> = {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
      before: params?.before,
    };

    if (params?.effective_status) {
      queryParams.effective_status = JSON.stringify(params.effective_status);
    }

    return this.client.get<PaginatedResponse<AdSet>>(`/${campaignId}/adsets`, queryParams);
  }

  /**
   * Get a single ad set by ID
   */
  async get(adSetId: string, fields?: string[]): Promise<AdSet> {
    return this.client.get<AdSet>(`/${adSetId}`, {
      fields: (fields || DEFAULT_FIELDS).join(','),
    });
  }

  /**
   * Create a new ad set
   */
  async create(adAccountId: string, params: AdSetCreateParams): Promise<{ id: string }> {
    const formattedId = formatAdAccountId(adAccountId);

    // Convert targeting object to JSON string if needed
    const body: Record<string, unknown> = { ...params };
    if (params.targeting) {
      body.targeting = JSON.stringify(params.targeting);
    }
    if (params.promoted_object) {
      body.promoted_object = JSON.stringify(params.promoted_object);
    }

    return this.client.post<{ id: string }>(`/${formattedId}/adsets`, body);
  }

  /**
   * Update an ad set
   */
  async update(adSetId: string, params: AdSetUpdateParams): Promise<{ success: boolean }> {
    const body: Record<string, unknown> = { ...params };
    if (params.targeting) {
      body.targeting = JSON.stringify(params.targeting);
    }

    return this.client.post<{ success: boolean }>(`/${adSetId}`, body);
  }

  /**
   * Delete an ad set (sets status to DELETED)
   */
  async delete(adSetId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/${adSetId}`);
  }

  /**
   * Pause an ad set
   */
  async pause(adSetId: string): Promise<{ success: boolean }> {
    return this.update(adSetId, { status: 'PAUSED' });
  }

  /**
   * Activate an ad set
   */
  async activate(adSetId: string): Promise<{ success: boolean }> {
    return this.update(adSetId, { status: 'ACTIVE' });
  }

  /**
   * Archive an ad set
   */
  async archive(adSetId: string): Promise<{ success: boolean }> {
    return this.update(adSetId, { status: 'ARCHIVED' });
  }

  /**
   * Update ad set budget
   */
  async updateBudget(adSetId: string, params: { daily_budget?: string; lifetime_budget?: string }): Promise<{ success: boolean }> {
    return this.update(adSetId, params);
  }

  /**
   * Update ad set targeting
   */
  async updateTargeting(adSetId: string, targeting: AdSetUpdateParams['targeting']): Promise<{ success: boolean }> {
    return this.update(adSetId, { targeting });
  }

  /**
   * Update ad set schedule
   */
  async updateSchedule(adSetId: string, params: { start_time?: string; end_time?: string }): Promise<{ success: boolean }> {
    return this.update(adSetId, params);
  }

  /**
   * Get ad set insights/metrics
   */
  async getInsights(adSetId: string, params?: InsightsParams): Promise<PaginatedResponse<Insights>> {
    const defaultFields = [
      'adset_id',
      'adset_name',
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

    return this.client.get<PaginatedResponse<Insights>>(`/${adSetId}/insights`, queryParams);
  }

  /**
   * Get ads within an ad set
   */
  async getAds(adSetId: string, params?: { fields?: string[]; limit?: number; after?: string }): Promise<PaginatedResponse<{ id: string; name: string; status: string }>> {
    const defaultFields = ['id', 'name', 'status', 'effective_status', 'creative'];
    return this.client.get<PaginatedResponse<{ id: string; name: string; status: string }>>(`/${adSetId}/ads`, {
      fields: (params?.fields || defaultFields).join(','),
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Duplicate an ad set
   */
  async duplicate(adSetId: string, params: {
    campaign_id?: string;
    deep_copy?: boolean;
    status_option?: 'ACTIVE' | 'PAUSED' | 'INHERITED';
    rename_options?: { rename_suffix?: string; rename_prefix?: string };
  }): Promise<{ copied_adset_id: string }> {
    const body: Record<string, unknown> = {
      deep_copy: params.deep_copy,
      status_option: params.status_option,
    };

    if (params.campaign_id) {
      body.campaign_id = params.campaign_id;
    }

    if (params.rename_options) {
      body.rename_options = JSON.stringify(params.rename_options);
    }

    return this.client.post<{ copied_adset_id: string }>(`/${adSetId}/copies`, body);
  }

  /**
   * Get estimated reach for targeting
   */
  async getDeliveryEstimate(adAccountId: string, params: {
    targeting_spec: Record<string, unknown>;
    optimization_goal: string;
  }): Promise<{ data: { estimate_ready: boolean; estimate_dau?: number }[] }> {
    const formattedId = formatAdAccountId(adAccountId);
    return this.client.get<{ data: { estimate_ready: boolean; estimate_dau?: number }[] }>(
      `/${formattedId}/delivery_estimate`,
      {
        targeting_spec: JSON.stringify(params.targeting_spec),
        optimization_goal: params.optimization_goal,
      }
    );
  }
}
