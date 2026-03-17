import { GoogleAdsClient } from './client';
import type { SearchResponse, MutateResponse, AdGroupStatus } from '../types';

export class AdGroupsApi {
  constructor(private client: GoogleAdsClient) {}

  /**
   * List ad groups
   */
  async list(options?: { campaignId?: string; status?: AdGroupStatus; limit?: number }): Promise<SearchResponse> {
    let query = `
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.type,
        ad_group.campaign,
        ad_group.cpc_bid_micros,
        ad_group.target_cpa_micros,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM ad_group
    `;

    const conditions: string[] = [];

    if (options?.campaignId) {
      conditions.push(`campaign.id = ${options.campaignId}`);
    }

    if (options?.status) {
      conditions.push(`ad_group.status = '${options.status}'`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY ad_group.name`;

    if (options?.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    return this.client.search(query);
  }

  /**
   * Get a specific ad group
   */
  async get(adGroupId: string): Promise<SearchResponse> {
    return this.client.search(`
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.type,
        ad_group.campaign,
        ad_group.cpc_bid_micros,
        ad_group.cpm_bid_micros,
        ad_group.target_cpa_micros,
        ad_group.target_roas,
        campaign.name,
        campaign.id,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM ad_group
      WHERE ad_group.id = ${adGroupId}
    `);
  }

  /**
   * Create an ad group
   */
  async create(
    campaignId: string,
    name: string,
    options?: {
      status?: AdGroupStatus;
      type?: string;
      cpcBidMicros?: string;
    }
  ): Promise<MutateResponse> {
    const customerId = (this.client as any).getCustomerId();

    const adGroup: Record<string, unknown> = {
      name,
      campaign: `customers/${customerId}/campaigns/${campaignId}`,
      status: options?.status || 'PAUSED',
      type: options?.type || 'SEARCH_STANDARD',
    };

    if (options?.cpcBidMicros) {
      adGroup.cpcBidMicros = options.cpcBidMicros;
    }

    return this.client.mutate('adGroups', [{ create: adGroup }]);
  }

  /**
   * Update an ad group
   */
  async update(
    adGroupId: string,
    updates: {
      name?: string;
      status?: AdGroupStatus;
      cpcBidMicros?: string;
      targetCpaMicros?: string;
    }
  ): Promise<MutateResponse> {
    const customerId = (this.client as any).getCustomerId();
    const resourceName = `customers/${customerId}/adGroups/${adGroupId}`;

    const adGroup: Record<string, unknown> = {
      resourceName,
      ...updates,
    };

    const updateMask = Object.keys(updates).map(k =>
      k.replace(/([A-Z])/g, '_$1').toLowerCase()
    ).join(',');

    return this.client.mutate('adGroups', [{
      update: adGroup,
      updateMask,
    }]);
  }

  /**
   * Pause an ad group
   */
  async pause(adGroupId: string): Promise<MutateResponse> {
    return this.update(adGroupId, { status: 'PAUSED' });
  }

  /**
   * Enable an ad group
   */
  async enable(adGroupId: string): Promise<MutateResponse> {
    return this.update(adGroupId, { status: 'ENABLED' });
  }

  /**
   * Remove an ad group
   */
  async remove(adGroupId: string): Promise<MutateResponse> {
    const customerId = (this.client as any).getCustomerId();
    const resourceName = `customers/${customerId}/adGroups/${adGroupId}`;

    return this.client.mutate('adGroups', [{
      remove: resourceName,
    }]);
  }

  /**
   * Set ad group bid
   */
  async setBid(adGroupId: string, cpcBidMicros: string): Promise<MutateResponse> {
    return this.update(adGroupId, { cpcBidMicros });
  }
}
