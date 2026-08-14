import type { SnapClient } from './client';
import type {
  Stats,
  StatsParams,
  StatsResponse,
  Granularity,
  StatsBreakdown,
} from '../types';

/**
 * Snapchat Stats API
 * Get performance metrics and analytics
 */
export class StatsApi {
  constructor(private readonly client: SnapClient) {}

  /**
   * Get stats for an ad account
   */
  async getAccountStats(adAccountId: string, params: StatsParams): Promise<Stats> {
    const queryParams = this.buildStatsParams(params);
    const response = await this.client.get<StatsResponse>(
      `/adaccounts/${adAccountId}/stats`,
      queryParams
    );
    return response.total_stats?.[0] || response.timeseries_stats?.[0] || ({} as Stats);
  }

  /**
   * Get stats for a campaign
   */
  async getCampaignStats(campaignId: string, params: StatsParams): Promise<Stats> {
    const queryParams = this.buildStatsParams(params);
    const response = await this.client.get<StatsResponse>(
      `/campaigns/${campaignId}/stats`,
      queryParams
    );
    return response.total_stats?.[0] || response.timeseries_stats?.[0] || ({} as Stats);
  }

  /**
   * Get stats for multiple campaigns
   */
  async getCampaignsStats(adAccountId: string, campaignIds: string[], params: StatsParams): Promise<Stats[]> {
    const queryParams = this.buildStatsParams(params);
    const response = await this.client.get<StatsResponse>(
      `/adaccounts/${adAccountId}/campaigns/stats`,
      {
        ...queryParams,
        campaign_id: campaignIds.join(','),
      }
    );
    return response.total_stats || response.timeseries_stats || [];
  }

  /**
   * Get stats for an ad squad
   */
  async getAdSquadStats(adSquadId: string, params: StatsParams): Promise<Stats> {
    const queryParams = this.buildStatsParams(params);
    const response = await this.client.get<StatsResponse>(
      `/adsquads/${adSquadId}/stats`,
      queryParams
    );
    return response.total_stats?.[0] || response.timeseries_stats?.[0] || ({} as Stats);
  }

  /**
   * Get stats for multiple ad squads
   */
  async getAdSquadsStats(adAccountId: string, adSquadIds: string[], params: StatsParams): Promise<Stats[]> {
    const queryParams = this.buildStatsParams(params);
    const response = await this.client.get<StatsResponse>(
      `/adaccounts/${adAccountId}/adsquads/stats`,
      {
        ...queryParams,
        adsquad_id: adSquadIds.join(','),
      }
    );
    return response.total_stats || response.timeseries_stats || [];
  }

  /**
   * Get stats for an ad
   */
  async getAdStats(adId: string, params: StatsParams): Promise<Stats> {
    const queryParams = this.buildStatsParams(params);
    const response = await this.client.get<StatsResponse>(
      `/ads/${adId}/stats`,
      queryParams
    );
    return response.total_stats?.[0] || response.timeseries_stats?.[0] || ({} as Stats);
  }

  /**
   * Get stats for multiple ads
   */
  async getAdsStats(adAccountId: string, adIds: string[], params: StatsParams): Promise<Stats[]> {
    const queryParams = this.buildStatsParams(params);
    const response = await this.client.get<StatsResponse>(
      `/adaccounts/${adAccountId}/ads/stats`,
      {
        ...queryParams,
        ad_id: adIds.join(','),
      }
    );
    return response.total_stats || response.timeseries_stats || [];
  }

  /**
   * Get stats for a pixel
   */
  async getPixelStats(pixelId: string, params: StatsParams): Promise<Stats> {
    const queryParams = this.buildStatsParams(params);
    const response = await this.client.get<StatsResponse>(
      `/pixels/${pixelId}/stats`,
      queryParams
    );
    return response.total_stats?.[0] || response.timeseries_stats?.[0] || ({} as Stats);
  }

  /**
   * Build query parameters for stats requests
   */
  private buildStatsParams(params: StatsParams): Record<string, string | number | boolean | undefined> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      start_time: params.start_time,
      end_time: params.end_time,
      granularity: params.granularity || 'DAY',
    };

    if (params.breakdown) {
      queryParams.breakdown = params.breakdown;
    }

    if (params.fields?.length) {
      queryParams.fields = params.fields.join(',');
    }

    if (params.swipe_up_attribution_window) {
      queryParams.swipe_up_attribution_window = params.swipe_up_attribution_window;
    }

    if (params.view_attribution_window) {
      queryParams.view_attribution_window = params.view_attribution_window;
    }

    if (params.conversion_source_types?.length) {
      queryParams.conversion_source_types = params.conversion_source_types.join(',');
    }

    return queryParams;
  }

  /**
   * Get daily stats for a campaign
   */
  async getDailyStats(
    entityType: 'campaign' | 'adsquad' | 'ad',
    entityId: string,
    startDate: string,
    endDate: string
  ): Promise<Stats> {
    const params: StatsParams = {
      start_time: startDate,
      end_time: endDate,
      granularity: 'DAY',
    };

    switch (entityType) {
      case 'campaign':
        return this.getCampaignStats(entityId, params);
      case 'adsquad':
        return this.getAdSquadStats(entityId, params);
      case 'ad':
        return this.getAdStats(entityId, params);
    }
  }

  /**
   * Get hourly stats for a campaign
   */
  async getHourlyStats(
    entityType: 'campaign' | 'adsquad' | 'ad',
    entityId: string,
    startDate: string,
    endDate: string
  ): Promise<Stats> {
    const params: StatsParams = {
      start_time: startDate,
      end_time: endDate,
      granularity: 'HOUR',
    };

    switch (entityType) {
      case 'campaign':
        return this.getCampaignStats(entityId, params);
      case 'adsquad':
        return this.getAdSquadStats(entityId, params);
      case 'ad':
        return this.getAdStats(entityId, params);
    }
  }

  /**
   * Get lifetime stats (total)
   */
  async getLifetimeStats(
    entityType: 'campaign' | 'adsquad' | 'ad' | 'account',
    entityId: string
  ): Promise<Stats> {
    // Use a very wide date range for lifetime stats
    const params: StatsParams = {
      start_time: '2016-01-01T00:00:00.000Z',
      end_time: new Date().toISOString(),
      granularity: 'TOTAL',
    };

    switch (entityType) {
      case 'campaign':
        return this.getCampaignStats(entityId, params);
      case 'adsquad':
        return this.getAdSquadStats(entityId, params);
      case 'ad':
        return this.getAdStats(entityId, params);
      case 'account':
        return this.getAccountStats(entityId, params);
    }
  }

  /**
   * Get stats with breakdown
   */
  async getStatsWithBreakdown(
    entityType: 'campaign' | 'adsquad' | 'ad' | 'account',
    entityId: string,
    breakdown: StatsBreakdown,
    startDate: string,
    endDate: string,
    granularity: Granularity = 'DAY'
  ): Promise<Stats> {
    const params: StatsParams = {
      start_time: startDate,
      end_time: endDate,
      granularity,
      breakdown,
    };

    switch (entityType) {
      case 'campaign':
        return this.getCampaignStats(entityId, params);
      case 'adsquad':
        return this.getAdSquadStats(entityId, params);
      case 'ad':
        return this.getAdStats(entityId, params);
      case 'account':
        return this.getAccountStats(entityId, params);
    }
  }

  /**
   * Get conversion stats with attribution windows
   */
  async getConversionStats(
    entityType: 'campaign' | 'adsquad' | 'ad' | 'account',
    entityId: string,
    startDate: string,
    endDate: string,
    options?: {
      swipeUpWindow?: '1_DAY' | '7_DAY' | '28_DAY';
      viewWindow?: '1_HOUR' | '3_HOUR' | '6_HOUR' | '1_DAY' | '7_DAY' | '28_DAY';
    }
  ): Promise<Stats> {
    const params: StatsParams = {
      start_time: startDate,
      end_time: endDate,
      granularity: 'DAY',
      swipe_up_attribution_window: options?.swipeUpWindow || '28_DAY',
      view_attribution_window: options?.viewWindow || '1_DAY',
      fields: [
        'impressions',
        'swipes',
        'spend',
        'conversion_purchases',
        'conversion_purchases_value',
        'conversion_sign_ups',
        'conversion_add_carts',
        'conversion_page_views',
        'conversion_app_installs',
        'conversion_app_opens',
      ],
    };

    switch (entityType) {
      case 'campaign':
        return this.getCampaignStats(entityId, params);
      case 'adsquad':
        return this.getAdSquadStats(entityId, params);
      case 'ad':
        return this.getAdStats(entityId, params);
      case 'account':
        return this.getAccountStats(entityId, params);
    }
  }
}
