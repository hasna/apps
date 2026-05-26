import type { MetaClient } from './client';
import type {
  Ad,
  AdCreateParams,
  AdUpdateParams,
  AdListParams,
  PaginatedResponse,
  Insights,
  InsightsParams,
} from '../types';
import { formatAdAccountId } from '../utils/config';

const DEFAULT_FIELDS = [
  'id',
  'account_id',
  'campaign_id',
  'adset_id',
  'name',
  'status',
  'effective_status',
  'creative',
  'tracking_specs',
  'created_time',
  'updated_time',
];

/**
 * Meta Ads API
 * Create and manage individual ads
 */
export class AdsApi {
  constructor(private readonly client: MetaClient) {}

  /**
   * List ads for an ad account
   */
  async list(adAccountId: string, params?: AdListParams): Promise<PaginatedResponse<Ad>> {
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

    return this.client.get<PaginatedResponse<Ad>>(`/${formattedId}/ads`, queryParams);
  }

  /**
   * List ads for an ad set
   */
  async listByAdSet(adSetId: string, params?: AdListParams): Promise<PaginatedResponse<Ad>> {
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

    return this.client.get<PaginatedResponse<Ad>>(`/${adSetId}/ads`, queryParams);
  }

  /**
   * List ads for a campaign
   */
  async listByCampaign(campaignId: string, params?: AdListParams): Promise<PaginatedResponse<Ad>> {
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

    return this.client.get<PaginatedResponse<Ad>>(`/${campaignId}/ads`, queryParams);
  }

  /**
   * Get a single ad by ID
   */
  async get(adId: string, fields?: string[]): Promise<Ad> {
    return this.client.get<Ad>(`/${adId}`, {
      fields: (fields || DEFAULT_FIELDS).join(','),
    });
  }

  /**
   * Create a new ad
   */
  async create(adAccountId: string, params: AdCreateParams): Promise<{ id: string }> {
    const formattedId = formatAdAccountId(adAccountId);

    const body: Record<string, unknown> = {
      name: params.name,
      adset_id: params.adset_id,
      status: params.status || 'PAUSED',
    };

    // Handle creative specification
    if ('creative_id' in params.creative) {
      body.creative = JSON.stringify({ creative_id: params.creative.creative_id });
    } else {
      body.creative = JSON.stringify(params.creative);
    }

    if (params.tracking_specs) {
      body.tracking_specs = JSON.stringify(params.tracking_specs);
    }

    if (params.conversion_specs) {
      body.conversion_specs = JSON.stringify(params.conversion_specs);
    }

    return this.client.post<{ id: string }>(`/${formattedId}/ads`, body);
  }

  /**
   * Update an ad
   */
  async update(adId: string, params: AdUpdateParams): Promise<{ success: boolean }> {
    const body: Record<string, unknown> = { ...params };

    if (params.creative) {
      body.creative = JSON.stringify(params.creative);
    }

    if (params.tracking_specs) {
      body.tracking_specs = JSON.stringify(params.tracking_specs);
    }

    return this.client.post<{ success: boolean }>(`/${adId}`, body);
  }

  /**
   * Delete an ad (sets status to DELETED)
   */
  async delete(adId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/${adId}`);
  }

  /**
   * Pause an ad
   */
  async pause(adId: string): Promise<{ success: boolean }> {
    return this.update(adId, { status: 'PAUSED' });
  }

  /**
   * Activate an ad
   */
  async activate(adId: string): Promise<{ success: boolean }> {
    return this.update(adId, { status: 'ACTIVE' });
  }

  /**
   * Archive an ad
   */
  async archive(adId: string): Promise<{ success: boolean }> {
    return this.update(adId, { status: 'ARCHIVED' });
  }

  /**
   * Get ad insights/metrics
   */
  async getInsights(adId: string, params?: InsightsParams): Promise<PaginatedResponse<Insights>> {
    const defaultFields = [
      'ad_id',
      'ad_name',
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

    return this.client.get<PaginatedResponse<Insights>>(`/${adId}/insights`, queryParams);
  }

  /**
   * Get ad preview
   */
  async getPreview(adId: string, adFormat: 'DESKTOP_FEED_STANDARD' | 'MOBILE_FEED_STANDARD' | 'INSTAGRAM_STANDARD' | 'INSTANT_ARTICLE_STANDARD' | 'RIGHT_COLUMN_STANDARD' = 'DESKTOP_FEED_STANDARD'): Promise<{ data: { body: string }[] }> {
    return this.client.get<{ data: { body: string }[] }>(`/${adId}/previews`, {
      ad_format: adFormat,
    });
  }

  /**
   * Generate ad preview from creative spec
   */
  async generatePreview(adAccountId: string, params: {
    creative: Record<string, unknown>;
    ad_format: string;
  }): Promise<{ data: { body: string }[] }> {
    const formattedId = formatAdAccountId(adAccountId);
    return this.client.get<{ data: { body: string }[] }>(`/${formattedId}/generatepreviews`, {
      creative: JSON.stringify(params.creative),
      ad_format: params.ad_format,
    });
  }

  /**
   * Get lead forms associated with an ad
   */
  async getLeads(adId: string, params?: { limit?: number; after?: string }): Promise<PaginatedResponse<unknown>> {
    return this.client.get<PaginatedResponse<unknown>>(`/${adId}/leads`, {
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Duplicate an ad
   */
  async duplicate(adId: string, params: {
    adset_id?: string;
    status_option?: 'ACTIVE' | 'PAUSED' | 'INHERITED';
    rename_options?: { rename_suffix?: string; rename_prefix?: string };
  }): Promise<{ copied_ad_id: string }> {
    const body: Record<string, unknown> = {
      status_option: params.status_option,
    };

    if (params.adset_id) {
      body.adset_id = params.adset_id;
    }

    if (params.rename_options) {
      body.rename_options = JSON.stringify(params.rename_options);
    }

    return this.client.post<{ copied_ad_id: string }>(`/${adId}/copies`, body);
  }
}
