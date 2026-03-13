import { GoogleAdsClient } from './client';
import type { Campaign, CampaignBudget, SearchResponse, MutateResponse, CampaignStatus } from '../types';

export class CampaignsApi {
  constructor(private client: GoogleAdsClient) {}

  /**
   * List all campaigns
   */
  async list(options?: { status?: CampaignStatus; limit?: number }): Promise<SearchResponse> {
    let query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.bidding_strategy_type,
        campaign.campaign_budget,
        campaign.start_date,
        campaign.end_date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM campaign
    `;

    const conditions: string[] = [];

    if (options?.status) {
      conditions.push(`campaign.status = '${options.status}'`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY campaign.name`;

    if (options?.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    return this.client.search(query);
  }

  /**
   * Get a specific campaign
   */
  async get(campaignId: string): Promise<SearchResponse> {
    return this.client.search(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.advertising_channel_sub_type,
        campaign.bidding_strategy_type,
        campaign.campaign_budget,
        campaign.start_date,
        campaign.end_date,
        campaign.target_spend.target_spend_micros,
        campaign.target_spend.cpc_bid_ceiling_micros,
        campaign.manual_cpc.enhanced_cpc_enabled,
        campaign.maximize_conversions.target_cpa_micros,
        campaign.maximize_conversion_value.target_roas,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc
      FROM campaign
      WHERE campaign.id = ${campaignId}
    `);
  }

  /**
   * Create a new campaign
   */
  async create(
    name: string,
    budgetAmountMicros: string,
    channelType: string,
    options?: {
      status?: CampaignStatus;
      biddingStrategy?: string;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<MutateResponse> {
    const customerId = (this.client as any).getCustomerId();

    // First create the budget
    const budgetResponse = await this.client.mutate('campaignBudgets', [{
      create: {
        name: `Budget for ${name}`,
        amountMicros: budgetAmountMicros,
        deliveryMethod: 'STANDARD',
      }
    }]);

    const budgetResourceName = budgetResponse.results[0].resourceName;

    // Then create the campaign
    const campaign: Record<string, unknown> = {
      name,
      advertisingChannelType: channelType,
      status: options?.status || 'PAUSED',
      campaignBudget: budgetResourceName,
    };

    if (options?.startDate) {
      campaign.startDate = options.startDate;
    }

    if (options?.endDate) {
      campaign.endDate = options.endDate;
    }

    // Default to maximize clicks if no bidding strategy specified
    if (!options?.biddingStrategy || options.biddingStrategy === 'MAXIMIZE_CLICKS') {
      campaign.targetSpend = {};
    } else if (options.biddingStrategy === 'MANUAL_CPC') {
      campaign.manualCpc = { enhancedCpcEnabled: false };
    }

    return this.client.mutate('campaigns', [{ create: campaign }]);
  }

  /**
   * Update a campaign
   */
  async update(
    campaignId: string,
    updates: {
      name?: string;
      status?: CampaignStatus;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<MutateResponse> {
    const customerId = (this.client as any).getCustomerId();
    const resourceName = `customers/${customerId}/campaigns/${campaignId}`;

    const campaign: Record<string, unknown> = {
      resourceName,
      ...updates,
    };

    const updateMask = Object.keys(updates).map(k =>
      k.replace(/([A-Z])/g, '_$1').toLowerCase()
    ).join(',');

    return this.client.mutate('campaigns', [{
      update: campaign,
      updateMask,
    }]);
  }

  /**
   * Pause a campaign
   */
  async pause(campaignId: string): Promise<MutateResponse> {
    return this.update(campaignId, { status: 'PAUSED' });
  }

  /**
   * Enable a campaign
   */
  async enable(campaignId: string): Promise<MutateResponse> {
    return this.update(campaignId, { status: 'ENABLED' });
  }

  /**
   * Remove a campaign
   */
  async remove(campaignId: string): Promise<MutateResponse> {
    const customerId = (this.client as any).getCustomerId();
    const resourceName = `customers/${customerId}/campaigns/${campaignId}`;

    return this.client.mutate('campaigns', [{
      remove: resourceName,
    }]);
  }

  /**
   * Get campaign performance report
   */
  async getPerformance(
    campaignId: string,
    startDate: string,
    endDate: string
  ): Promise<SearchResponse> {
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
        metrics.search_impression_share,
        metrics.search_rank_lost_impression_share,
        metrics.search_budget_lost_impression_share
      FROM campaign
      WHERE campaign.id = ${campaignId}
        AND segments.date BETWEEN '${startDate}' AND '${endDate}'
      ORDER BY segments.date
    `);
  }

  /**
   * List campaign budgets
   */
  async listBudgets(): Promise<SearchResponse> {
    return this.client.search(`
      SELECT
        campaign_budget.id,
        campaign_budget.name,
        campaign_budget.amount_micros,
        campaign_budget.delivery_method,
        campaign_budget.explicitly_shared,
        campaign_budget.total_amount_micros,
        campaign_budget.status
      FROM campaign_budget
      ORDER BY campaign_budget.name
    `);
  }

  /**
   * Update campaign budget
   */
  async updateBudget(budgetId: string, amountMicros: string): Promise<MutateResponse> {
    const customerId = (this.client as any).getCustomerId();
    const resourceName = `customers/${customerId}/campaignBudgets/${budgetId}`;

    return this.client.mutate('campaignBudgets', [{
      update: {
        resourceName,
        amountMicros,
      },
      updateMask: 'amount_micros',
    }]);
  }
}
