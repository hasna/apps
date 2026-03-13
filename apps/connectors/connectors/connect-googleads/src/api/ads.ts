import { GoogleAdsClient } from './client';
import type { SearchResponse, MutateResponse, AdStatus } from '../types';

export class AdsApi {
  constructor(private client: GoogleAdsClient) {}

  /**
   * List ads
   */
  async list(options?: { adGroupId?: string; campaignId?: string; status?: AdStatus; limit?: number }): Promise<SearchResponse> {
    let query = `
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.name,
        ad_group_ad.ad.type,
        ad_group_ad.ad.final_urls,
        ad_group_ad.status,
        ad_group_ad.ad_group,
        ad_group_ad.policy_summary.approval_status,
        ad_group_ad.policy_summary.review_status,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group.name,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM ad_group_ad
    `;

    const conditions: string[] = [];

    if (options?.adGroupId) {
      conditions.push(`ad_group.id = ${options.adGroupId}`);
    }

    if (options?.campaignId) {
      conditions.push(`campaign.id = ${options.campaignId}`);
    }

    if (options?.status) {
      conditions.push(`ad_group_ad.status = '${options.status}'`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY ad_group_ad.ad.id`;

    if (options?.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    return this.client.search(query);
  }

  /**
   * Get a specific ad
   */
  async get(adGroupId: string, adId: string): Promise<SearchResponse> {
    return this.client.search(`
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.name,
        ad_group_ad.ad.type,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad.final_mobile_urls,
        ad_group_ad.ad.tracking_url_template,
        ad_group_ad.ad.display_url,
        ad_group_ad.status,
        ad_group_ad.ad_group,
        ad_group_ad.policy_summary.approval_status,
        ad_group_ad.policy_summary.review_status,
        ad_group_ad.policy_summary.policy_topic_entries,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.responsive_search_ad.path1,
        ad_group_ad.ad.responsive_search_ad.path2,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM ad_group_ad
      WHERE ad_group.id = ${adGroupId}
        AND ad_group_ad.ad.id = ${adId}
    `);
  }

  /**
   * Create a responsive search ad
   */
  async createResponsiveSearchAd(
    adGroupId: string,
    headlines: string[],
    descriptions: string[],
    finalUrls: string[],
    options?: {
      path1?: string;
      path2?: string;
      status?: AdStatus;
    }
  ): Promise<MutateResponse> {
    const customerId = (this.client as any).getCustomerId();

    const ad: Record<string, unknown> = {
      adGroup: `customers/${customerId}/adGroups/${adGroupId}`,
      status: options?.status || 'PAUSED',
      ad: {
        finalUrls,
        responsiveSearchAd: {
          headlines: headlines.map(text => ({ text })),
          descriptions: descriptions.map(text => ({ text })),
        },
      },
    };

    if (options?.path1) {
      (ad.ad as any).responsiveSearchAd.path1 = options.path1;
    }
    if (options?.path2) {
      (ad.ad as any).responsiveSearchAd.path2 = options.path2;
    }

    return this.client.mutate('adGroupAds', [{ create: ad }]);
  }

  /**
   * Update ad status
   */
  async updateStatus(adGroupId: string, adId: string, status: AdStatus): Promise<MutateResponse> {
    const customerId = (this.client as any).getCustomerId();
    const resourceName = `customers/${customerId}/adGroupAds/${adGroupId}~${adId}`;

    return this.client.mutate('adGroupAds', [{
      update: {
        resourceName,
        status,
      },
      updateMask: 'status',
    }]);
  }

  /**
   * Pause an ad
   */
  async pause(adGroupId: string, adId: string): Promise<MutateResponse> {
    return this.updateStatus(adGroupId, adId, 'PAUSED');
  }

  /**
   * Enable an ad
   */
  async enable(adGroupId: string, adId: string): Promise<MutateResponse> {
    return this.updateStatus(adGroupId, adId, 'ENABLED');
  }

  /**
   * Remove an ad
   */
  async remove(adGroupId: string, adId: string): Promise<MutateResponse> {
    const customerId = (this.client as any).getCustomerId();
    const resourceName = `customers/${customerId}/adGroupAds/${adGroupId}~${adId}`;

    return this.client.mutate('adGroupAds', [{
      remove: resourceName,
    }]);
  }
}
