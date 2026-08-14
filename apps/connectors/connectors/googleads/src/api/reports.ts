import { GoogleAdsClient } from './client';
import type { SearchResponse } from '../types';

export class ReportsApi {
  constructor(private client: GoogleAdsClient) {}

  /**
   * Execute a custom GAQL query
   */
  async query(gaqlQuery: string): Promise<SearchResponse> {
    return this.client.search(gaqlQuery);
  }

  /**
   * Execute a streaming query for large datasets
   */
  async queryStream(gaqlQuery: string): Promise<SearchResponse> {
    return this.client.searchStream(gaqlQuery);
  }

  /**
   * Account performance report
   */
  async accountPerformance(startDate: string, endDate: string): Promise<SearchResponse> {
    return this.client.search(`
      SELECT
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc,
        metrics.average_cpm,
        metrics.all_conversions,
        metrics.all_conversions_value,
        metrics.view_through_conversions
      FROM customer
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      ORDER BY segments.date
    `);
  }

  /**
   * Campaign performance report
   */
  async campaignPerformance(startDate: string, endDate: string, options?: { campaignId?: string }): Promise<SearchResponse> {
    let query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc,
        metrics.search_impression_share,
        metrics.search_rank_lost_impression_share,
        metrics.search_budget_lost_impression_share
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;

    if (options?.campaignId) {
      query += ` AND campaign.id = ${options.campaignId}`;
    }

    query += ` ORDER BY campaign.name, segments.date`;

    return this.client.search(query);
  }

  /**
   * Ad group performance report
   */
  async adGroupPerformance(startDate: string, endDate: string, options?: { campaignId?: string; adGroupId?: string }): Promise<SearchResponse> {
    let query = `
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        campaign.id,
        campaign.name,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc
      FROM ad_group
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;

    if (options?.campaignId) {
      query += ` AND campaign.id = ${options.campaignId}`;
    }

    if (options?.adGroupId) {
      query += ` AND ad_group.id = ${options.adGroupId}`;
    }

    query += ` ORDER BY ad_group.name, segments.date`;

    return this.client.search(query);
  }

  /**
   * Keyword performance report
   */
  async keywordPerformance(startDate: string, endDate: string, options?: { campaignId?: string; adGroupId?: string; limit?: number }): Promise<SearchResponse> {
    let query = `
      SELECT
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.quality_info.quality_score,
        ad_group.id,
        ad_group.name,
        campaign.id,
        campaign.name,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc,
        metrics.average_position
      FROM keyword_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;

    if (options?.campaignId) {
      query += ` AND campaign.id = ${options.campaignId}`;
    }

    if (options?.adGroupId) {
      query += ` AND ad_group.id = ${options.adGroupId}`;
    }

    query += ` ORDER BY metrics.impressions DESC`;

    if (options?.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    return this.client.search(query);
  }

  /**
   * Ad performance report
   */
  async adPerformance(startDate: string, endDate: string, options?: { campaignId?: string; adGroupId?: string }): Promise<SearchResponse> {
    let query = `
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.type,
        ad_group_ad.status,
        ad_group_ad.policy_summary.approval_status,
        ad_group.id,
        ad_group.name,
        campaign.id,
        campaign.name,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc
      FROM ad_group_ad
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;

    if (options?.campaignId) {
      query += ` AND campaign.id = ${options.campaignId}`;
    }

    if (options?.adGroupId) {
      query += ` AND ad_group.id = ${options.adGroupId}`;
    }

    query += ` ORDER BY ad_group_ad.ad.id, segments.date`;

    return this.client.search(query);
  }

  /**
   * Geographic performance report
   */
  async geographicPerformance(startDate: string, endDate: string, options?: { campaignId?: string }): Promise<SearchResponse> {
    let query = `
      SELECT
        geographic_view.country_criterion_id,
        geographic_view.location_type,
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM geographic_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;

    if (options?.campaignId) {
      query += ` AND campaign.id = ${options.campaignId}`;
    }

    query += ` ORDER BY metrics.impressions DESC`;

    return this.client.search(query);
  }

  /**
   * Device performance report
   */
  async devicePerformance(startDate: string, endDate: string, options?: { campaignId?: string }): Promise<SearchResponse> {
    let query = `
      SELECT
        segments.device,
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;

    if (options?.campaignId) {
      query += ` AND campaign.id = ${options.campaignId}`;
    }

    query += ` ORDER BY segments.device`;

    return this.client.search(query);
  }

  /**
   * Hour of day performance report
   */
  async hourOfDayPerformance(startDate: string, endDate: string, options?: { campaignId?: string }): Promise<SearchResponse> {
    let query = `
      SELECT
        segments.hour,
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;

    if (options?.campaignId) {
      query += ` AND campaign.id = ${options.campaignId}`;
    }

    query += ` ORDER BY segments.hour`;

    return this.client.search(query);
  }

  /**
   * Day of week performance report
   */
  async dayOfWeekPerformance(startDate: string, endDate: string, options?: { campaignId?: string }): Promise<SearchResponse> {
    let query = `
      SELECT
        segments.day_of_week,
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;

    if (options?.campaignId) {
      query += ` AND campaign.id = ${options.campaignId}`;
    }

    query += ` ORDER BY segments.day_of_week`;

    return this.client.search(query);
  }

  /**
   * Conversion tracking report
   */
  async conversionReport(startDate: string, endDate: string, options?: { campaignId?: string }): Promise<SearchResponse> {
    let query = `
      SELECT
        segments.conversion_action,
        segments.conversion_action_name,
        campaign.id,
        campaign.name,
        metrics.conversions,
        metrics.conversions_value,
        metrics.all_conversions,
        metrics.all_conversions_value,
        metrics.view_through_conversions,
        metrics.cost_per_conversion
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;

    if (options?.campaignId) {
      query += ` AND campaign.id = ${options.campaignId}`;
    }

    query += ` ORDER BY metrics.conversions DESC`;

    return this.client.search(query);
  }

  /**
   * Audience performance report
   */
  async audiencePerformance(startDate: string, endDate: string, options?: { campaignId?: string }): Promise<SearchResponse> {
    let query = `
      SELECT
        campaign_audience_view.resource_name,
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM campaign_audience_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;

    if (options?.campaignId) {
      query += ` AND campaign.id = ${options.campaignId}`;
    }

    query += ` ORDER BY metrics.impressions DESC`;

    return this.client.search(query);
  }

  /**
   * Landing page performance report
   */
  async landingPagePerformance(startDate: string, endDate: string, options?: { limit?: number }): Promise<SearchResponse> {
    let query = `
      SELECT
        landing_page_view.unexpanded_final_url,
        campaign.name,
        ad_group.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.mobile_friendly_clicks_percentage,
        metrics.speed_score
      FROM landing_page_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      ORDER BY metrics.impressions DESC
    `;

    if (options?.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    return this.client.search(query);
  }

  /**
   * Change history report
   */
  async changeHistory(options?: { startDate?: string; endDate?: string; limit?: number }): Promise<SearchResponse> {
    let query = `
      SELECT
        change_event.change_date_time,
        change_event.change_resource_type,
        change_event.change_resource_name,
        change_event.client_type,
        change_event.user_email,
        change_event.old_resource,
        change_event.new_resource,
        change_event.resource_change_operation
      FROM change_event
    `;

    const conditions: string[] = [];

    if (options?.startDate && options?.endDate) {
      conditions.push(`change_event.change_date_time >= '${options.startDate}'`);
      conditions.push(`change_event.change_date_time <= '${options.endDate}'`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY change_event.change_date_time DESC`;

    if (options?.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    return this.client.search(query);
  }
}
