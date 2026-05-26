import { GoogleAdsClient } from './client';
import type { SearchResponse, MutateResponse, KeywordMatchType, AdGroupCriterionStatus } from '../types';

export class KeywordsApi {
  constructor(private client: GoogleAdsClient) {}

  /**
   * List keywords
   */
  async list(options?: { adGroupId?: string; campaignId?: string; status?: AdGroupCriterionStatus; limit?: number }): Promise<SearchResponse> {
    let query = `
      SELECT
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.negative,
        ad_group_criterion.cpc_bid_micros,
        ad_group_criterion.final_urls,
        ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.creative_quality_score,
        ad_group_criterion.quality_info.post_click_quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr,
        ad_group.name,
        ad_group.id,
        campaign.name,
        campaign.id,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM keyword_view
    `;

    const conditions: string[] = [];

    if (options?.adGroupId) {
      conditions.push(`ad_group.id = ${options.adGroupId}`);
    }

    if (options?.campaignId) {
      conditions.push(`campaign.id = ${options.campaignId}`);
    }

    if (options?.status) {
      conditions.push(`ad_group_criterion.status = '${options.status}'`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY ad_group_criterion.keyword.text`;

    if (options?.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    return this.client.search(query);
  }

  /**
   * Get a specific keyword
   */
  async get(adGroupId: string, criterionId: string): Promise<SearchResponse> {
    return this.client.search(`
      SELECT
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.negative,
        ad_group_criterion.cpc_bid_micros,
        ad_group_criterion.final_urls,
        ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.creative_quality_score,
        ad_group_criterion.quality_info.post_click_quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr,
        ad_group.name,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM keyword_view
      WHERE ad_group.id = ${adGroupId}
        AND ad_group_criterion.criterion_id = ${criterionId}
    `);
  }

  /**
   * Add keywords to an ad group
   */
  async add(
    adGroupId: string,
    keywords: Array<{
      text: string;
      matchType: KeywordMatchType;
      cpcBidMicros?: string;
      finalUrls?: string[];
    }>,
    options?: { status?: AdGroupCriterionStatus }
  ): Promise<MutateResponse> {
    const customerId = this.client.getCustomerId();

    const operations = keywords.map(kw => ({
      create: {
        adGroup: `customers/${customerId}/adGroups/${adGroupId}`,
        status: options?.status || 'ENABLED',
        keyword: {
          text: kw.text,
          matchType: kw.matchType,
        },
        cpcBidMicros: kw.cpcBidMicros,
        finalUrls: kw.finalUrls,
      },
    }));

    return this.client.mutate('adGroupCriteria', operations);
  }

  /**
   * Add a single keyword
   */
  async addKeyword(
    adGroupId: string,
    text: string,
    matchType: KeywordMatchType,
    options?: {
      cpcBidMicros?: string;
      finalUrls?: string[];
      status?: AdGroupCriterionStatus;
    }
  ): Promise<MutateResponse> {
    return this.add(adGroupId, [{ text, matchType, cpcBidMicros: options?.cpcBidMicros, finalUrls: options?.finalUrls }], { status: options?.status });
  }

  /**
   * Update keyword status
   */
  async updateStatus(adGroupId: string, criterionId: string, status: AdGroupCriterionStatus): Promise<MutateResponse> {
    const customerId = this.client.getCustomerId();
    const resourceName = `customers/${customerId}/adGroupCriteria/${adGroupId}~${criterionId}`;

    return this.client.mutate('adGroupCriteria', [{
      update: {
        resourceName,
        status,
      },
      updateMask: 'status',
    }]);
  }

  /**
   * Update keyword bid
   */
  async updateBid(adGroupId: string, criterionId: string, cpcBidMicros: string): Promise<MutateResponse> {
    const customerId = this.client.getCustomerId();
    const resourceName = `customers/${customerId}/adGroupCriteria/${adGroupId}~${criterionId}`;

    return this.client.mutate('adGroupCriteria', [{
      update: {
        resourceName,
        cpcBidMicros,
      },
      updateMask: 'cpc_bid_micros',
    }]);
  }

  /**
   * Pause a keyword
   */
  async pause(adGroupId: string, criterionId: string): Promise<MutateResponse> {
    return this.updateStatus(adGroupId, criterionId, 'PAUSED');
  }

  /**
   * Enable a keyword
   */
  async enable(adGroupId: string, criterionId: string): Promise<MutateResponse> {
    return this.updateStatus(adGroupId, criterionId, 'ENABLED');
  }

  /**
   * Remove a keyword
   */
  async remove(adGroupId: string, criterionId: string): Promise<MutateResponse> {
    const customerId = this.client.getCustomerId();
    const resourceName = `customers/${customerId}/adGroupCriteria/${adGroupId}~${criterionId}`;

    return this.client.mutate('adGroupCriteria', [{
      remove: resourceName,
    }]);
  }

  /**
   * Add negative keywords to ad group
   */
  async addNegative(
    adGroupId: string,
    keywords: Array<{ text: string; matchType: KeywordMatchType }>
  ): Promise<MutateResponse> {
    const customerId = this.client.getCustomerId();

    const operations = keywords.map(kw => ({
      create: {
        adGroup: `customers/${customerId}/adGroups/${adGroupId}`,
        negative: true,
        keyword: {
          text: kw.text,
          matchType: kw.matchType,
        },
      },
    }));

    return this.client.mutate('adGroupCriteria', operations);
  }

  /**
   * List negative keywords for a campaign
   */
  async listCampaignNegatives(campaignId: string): Promise<SearchResponse> {
    return this.client.search(`
      SELECT
        campaign_criterion.criterion_id,
        campaign_criterion.keyword.text,
        campaign_criterion.keyword.match_type,
        campaign_criterion.negative,
        campaign.name
      FROM campaign_criterion
      WHERE campaign.id = ${campaignId}
        AND campaign_criterion.type = 'KEYWORD'
        AND campaign_criterion.negative = TRUE
    `);
  }

  /**
   * Add negative keywords to campaign
   */
  async addCampaignNegative(
    campaignId: string,
    keywords: Array<{ text: string; matchType: KeywordMatchType }>
  ): Promise<MutateResponse> {
    const customerId = this.client.getCustomerId();

    const operations = keywords.map(kw => ({
      create: {
        campaign: `customers/${customerId}/campaigns/${campaignId}`,
        negative: true,
        keyword: {
          text: kw.text,
          matchType: kw.matchType,
        },
      },
    }));

    return this.client.mutate('campaignCriteria', operations);
  }

  /**
   * Get keyword search terms report
   */
  async getSearchTerms(options?: { campaignId?: string; adGroupId?: string; startDate?: string; endDate?: string; limit?: number }): Promise<SearchResponse> {
    let query = `
      SELECT
        search_term_view.search_term,
        search_term_view.status,
        segments.keyword.info.text,
        segments.keyword.info.match_type,
        ad_group.name,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM search_term_view
    `;

    const conditions: string[] = [];

    if (options?.campaignId) {
      conditions.push(`campaign.id = ${options.campaignId}`);
    }

    if (options?.adGroupId) {
      conditions.push(`ad_group.id = ${options.adGroupId}`);
    }

    if (options?.startDate && options?.endDate) {
      conditions.push(`segments.date BETWEEN '${options.startDate}' AND '${options.endDate}'`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY metrics.impressions DESC`;

    if (options?.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    return this.client.search(query);
  }
}
