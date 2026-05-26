import type { SnapClient } from './client';
import type {
  Campaign,
  CampaignCreateParams,
  CampaignUpdateParams,
  CampaignResponse,
} from '../types';

/**
 * Snapchat Campaigns API
 * Manage advertising campaigns
 */
export class CampaignsApi {
  constructor(private readonly client: SnapClient) {}

  /**
   * List all campaigns for an ad account
   */
  async list(adAccountId: string): Promise<Campaign[]> {
    const response = await this.client.get<CampaignResponse>(
      `/adaccounts/${adAccountId}/campaigns`
    );
    return response.campaigns?.map(c => c.campaign) || [];
  }

  /**
   * Get a specific campaign by ID
   */
  async get(campaignId: string): Promise<Campaign> {
    const response = await this.client.get<CampaignResponse>(`/campaigns/${campaignId}`);
    const campaign = response.campaigns?.[0]?.campaign;
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }
    return campaign;
  }

  /**
   * Create a new campaign
   */
  async create(params: CampaignCreateParams): Promise<Campaign> {
    const response = await this.client.post<CampaignResponse>(
      `/adaccounts/${params.ad_account_id}/campaigns`,
      {
        campaigns: [params],
      }
    );
    const campaign = response.campaigns?.[0]?.campaign;
    if (!campaign) {
      throw new Error('Failed to create campaign');
    }
    return campaign;
  }

  /**
   * Update a campaign
   */
  async update(campaignId: string, params: CampaignUpdateParams): Promise<Campaign> {
    const response = await this.client.put<CampaignResponse>(
      `/campaigns/${campaignId}`,
      {
        campaigns: [{ id: campaignId, ...params }],
      }
    );
    const campaign = response.campaigns?.[0]?.campaign;
    if (!campaign) {
      throw new Error('Failed to update campaign');
    }
    return campaign;
  }

  /**
   * Delete a campaign (set status to DELETED)
   */
  async delete(campaignId: string): Promise<void> {
    await this.client.delete(`/campaigns/${campaignId}`);
  }

  /**
   * Pause a campaign
   */
  async pause(campaignId: string): Promise<Campaign> {
    return this.update(campaignId, { status: 'PAUSED' });
  }

  /**
   * Activate a campaign
   */
  async activate(campaignId: string): Promise<Campaign> {
    return this.update(campaignId, { status: 'ACTIVE' });
  }
}
