import type { MetaClient } from './client';
import type {
  Insights,
  InsightsParams,
  DatePreset,
  InsightsBreakdown,
  ActionBreakdown,
  PaginatedResponse,
} from '../types';
import { formatAdAccountId } from '../utils/config';

const DEFAULT_FIELDS = [
  'account_id',
  'account_name',
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',
  'impressions',
  'clicks',
  'spend',
  'reach',
  'frequency',
  'cpc',
  'cpm',
  'ctr',
  'cpp',
  'unique_clicks',
  'unique_ctr',
  'cost_per_unique_click',
  'actions',
  'conversions',
  'cost_per_action_type',
  'date_start',
  'date_stop',
];

const VIDEO_FIELDS = [
  'video_avg_time_watched_actions',
  'video_p25_watched_actions',
  'video_p50_watched_actions',
  'video_p75_watched_actions',
  'video_p100_watched_actions',
];

const CONVERSION_FIELDS = [
  'website_ctr',
  'website_purchase_roas',
  'purchase_roas',
  'mobile_app_purchase_roas',
];

/**
 * Meta Insights API
 * Retrieve performance metrics and reporting data
 */
export class InsightsApi {
  constructor(private readonly client: MetaClient) {}

  /**
   * Get insights for an ad account
   */
  async getAccountInsights(adAccountId: string, params?: InsightsParams): Promise<PaginatedResponse<Insights>> {
    const formattedId = formatAdAccountId(adAccountId);
    return this.getInsights(formattedId, params);
  }

  /**
   * Get insights for a campaign
   */
  async getCampaignInsights(campaignId: string, params?: InsightsParams): Promise<PaginatedResponse<Insights>> {
    return this.getInsights(campaignId, params);
  }

  /**
   * Get insights for an ad set
   */
  async getAdSetInsights(adSetId: string, params?: InsightsParams): Promise<PaginatedResponse<Insights>> {
    return this.getInsights(adSetId, params);
  }

  /**
   * Get insights for an ad
   */
  async getAdInsights(adId: string, params?: InsightsParams): Promise<PaginatedResponse<Insights>> {
    return this.getInsights(adId, params);
  }

  /**
   * Generic insights fetcher
   */
  private async getInsights(objectId: string, params?: InsightsParams): Promise<PaginatedResponse<Insights>> {
    const fields = params?.fields || DEFAULT_FIELDS;

    const queryParams: Record<string, string | number | boolean | string[] | undefined> = {
      fields: fields.join(','),
      date_preset: params?.date_preset,
      level: params?.level,
      limit: params?.limit,
      after: params?.after,
      use_account_attribution_setting: params?.use_account_attribution_setting,
    };

    if (params?.time_range) {
      queryParams.time_range = JSON.stringify(params.time_range);
    }

    if (params?.time_increment !== undefined) {
      queryParams.time_increment = typeof params.time_increment === 'number'
        ? params.time_increment.toString()
        : params.time_increment;
    }

    if (params?.breakdowns && params.breakdowns.length > 0) {
      queryParams.breakdowns = params.breakdowns.join(',');
    }

    if (params?.action_breakdowns && params.action_breakdowns.length > 0) {
      queryParams.action_breakdowns = params.action_breakdowns.join(',');
    }

    if (params?.filtering && params.filtering.length > 0) {
      queryParams.filtering = JSON.stringify(params.filtering);
    }

    if (params?.sort && params.sort.length > 0) {
      queryParams.sort = params.sort.join(',');
    }

    return this.client.get<PaginatedResponse<Insights>>(`/${objectId}/insights`, queryParams);
  }

  /**
   * Get insights with specific date range
   */
  async getInsightsForDateRange(
    adAccountId: string,
    since: string,
    until: string,
    params?: Omit<InsightsParams, 'date_preset' | 'time_range'>
  ): Promise<PaginatedResponse<Insights>> {
    return this.getAccountInsights(adAccountId, {
      ...params,
      time_range: { since, until },
    });
  }

  /**
   * Get daily breakdown of insights
   */
  async getDailyInsights(adAccountId: string, params?: Omit<InsightsParams, 'time_increment'>): Promise<PaginatedResponse<Insights>> {
    return this.getAccountInsights(adAccountId, {
      ...params,
      time_increment: 1,
    });
  }

  /**
   * Get insights broken down by age and gender
   */
  async getDemographicInsights(adAccountId: string, params?: Omit<InsightsParams, 'breakdowns'>): Promise<PaginatedResponse<Insights>> {
    return this.getAccountInsights(adAccountId, {
      ...params,
      breakdowns: ['age', 'gender'],
    });
  }

  /**
   * Get insights broken down by country
   */
  async getGeoInsights(adAccountId: string, params?: Omit<InsightsParams, 'breakdowns'>): Promise<PaginatedResponse<Insights>> {
    return this.getAccountInsights(adAccountId, {
      ...params,
      breakdowns: ['country'],
    });
  }

  /**
   * Get insights broken down by platform (Facebook, Instagram, etc.)
   */
  async getPlatformInsights(adAccountId: string, params?: Omit<InsightsParams, 'breakdowns'>): Promise<PaginatedResponse<Insights>> {
    return this.getAccountInsights(adAccountId, {
      ...params,
      breakdowns: ['publisher_platform', 'platform_position'],
    });
  }

  /**
   * Get insights broken down by device
   */
  async getDeviceInsights(adAccountId: string, params?: Omit<InsightsParams, 'breakdowns'>): Promise<PaginatedResponse<Insights>> {
    return this.getAccountInsights(adAccountId, {
      ...params,
      breakdowns: ['device_platform', 'impression_device'],
    });
  }

  /**
   * Get video-specific insights
   */
  async getVideoInsights(objectId: string, params?: InsightsParams): Promise<PaginatedResponse<Insights>> {
    const fields = [...(params?.fields || DEFAULT_FIELDS), ...VIDEO_FIELDS];
    return this.getInsights(objectId, { ...params, fields });
  }

  /**
   * Get conversion-specific insights
   */
  async getConversionInsights(objectId: string, params?: InsightsParams): Promise<PaginatedResponse<Insights>> {
    const fields = [...(params?.fields || DEFAULT_FIELDS), ...CONVERSION_FIELDS];
    return this.getInsights(objectId, { ...params, fields });
  }

  /**
   * Get insights with action breakdowns
   */
  async getActionBreakdownInsights(
    objectId: string,
    actionBreakdowns: ActionBreakdown[],
    params?: Omit<InsightsParams, 'action_breakdowns'>
  ): Promise<PaginatedResponse<Insights>> {
    return this.getInsights(objectId, {
      ...params,
      action_breakdowns: actionBreakdowns,
    });
  }

  /**
   * Create an async report job for large data requests
   */
  async createAsyncReport(adAccountId: string, params: InsightsParams): Promise<{ report_run_id: string }> {
    const formattedId = formatAdAccountId(adAccountId);
    const fields = params.fields || DEFAULT_FIELDS;

    const body: Record<string, unknown> = {
      fields: fields.join(','),
      date_preset: params.date_preset,
      level: params.level,
    };

    if (params.time_range) {
      body.time_range = JSON.stringify(params.time_range);
    }

    if (params.time_increment !== undefined) {
      body.time_increment = params.time_increment;
    }

    if (params.breakdowns && params.breakdowns.length > 0) {
      body.breakdowns = params.breakdowns.join(',');
    }

    if (params.action_breakdowns && params.action_breakdowns.length > 0) {
      body.action_breakdowns = params.action_breakdowns.join(',');
    }

    if (params.filtering && params.filtering.length > 0) {
      body.filtering = JSON.stringify(params.filtering);
    }

    return this.client.post<{ report_run_id: string }>(`/${formattedId}/insights`, body);
  }

  /**
   * Check async report status
   */
  async getAsyncReportStatus(reportRunId: string): Promise<{
    id: string;
    async_status: 'Job Not Started' | 'Job Started' | 'Job Running' | 'Job Completed' | 'Job Failed' | 'Job Skipped';
    async_percent_completion: number;
  }> {
    return this.client.get<{
      id: string;
      async_status: 'Job Not Started' | 'Job Started' | 'Job Running' | 'Job Completed' | 'Job Failed' | 'Job Skipped';
      async_percent_completion: number;
    }>(`/${reportRunId}`, {
      fields: 'id,async_status,async_percent_completion',
    });
  }

  /**
   * Get async report results
   */
  async getAsyncReportResults(reportRunId: string, params?: { limit?: number; after?: string }): Promise<PaginatedResponse<Insights>> {
    return this.client.get<PaginatedResponse<Insights>>(`/${reportRunId}/insights`, {
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Helper: Get available date presets
   */
  getAvailableDatePresets(): DatePreset[] {
    return [
      'today',
      'yesterday',
      'this_month',
      'last_month',
      'this_quarter',
      'last_quarter',
      'this_year',
      'last_year',
      'last_3d',
      'last_7d',
      'last_14d',
      'last_28d',
      'last_30d',
      'last_90d',
      'last_week_mon_sun',
      'last_week_sun_sat',
      'this_week_mon_today',
      'this_week_sun_today',
      'maximum',
      'data_maximum',
    ];
  }

  /**
   * Helper: Get available breakdowns
   */
  getAvailableBreakdowns(): InsightsBreakdown[] {
    return [
      'age',
      'gender',
      'country',
      'region',
      'dma',
      'publisher_platform',
      'platform_position',
      'device_platform',
      'impression_device',
      'product_id',
      'hourly_stats_aggregated_by_advertiser_time_zone',
      'hourly_stats_aggregated_by_audience_time_zone',
    ];
  }

  /**
   * Helper: Get available action breakdowns
   */
  getAvailableActionBreakdowns(): ActionBreakdown[] {
    return [
      'action_type',
      'action_target_id',
      'action_destination',
      'action_device',
      'action_reaction',
      'action_carousel_card_id',
      'action_carousel_card_name',
      'action_video_sound',
      'action_video_type',
    ];
  }
}
