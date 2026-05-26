import type { SnapClient } from './client';
import type {
  AdSquad,
  AdSquadCreateParams,
  AdSquadUpdateParams,
  AdSquadResponse,
} from '../types';

/**
 * Snapchat Ad Squads API
 * Manage ad squads (Snapchat's equivalent of ad sets)
 */
export class AdSquadsApi {
  constructor(private readonly client: SnapClient) {}

  /**
   * List all ad squads for an ad account
   */
  async listByAccount(adAccountId: string): Promise<AdSquad[]> {
    const response = await this.client.get<AdSquadResponse>(
      `/adaccounts/${adAccountId}/adsquads`
    );
    return response.adsquads?.map(a => a.adsquad) || [];
  }

  /**
   * List all ad squads for a campaign
   */
  async listByCampaign(campaignId: string): Promise<AdSquad[]> {
    const response = await this.client.get<AdSquadResponse>(
      `/campaigns/${campaignId}/adsquads`
    );
    return response.adsquads?.map(a => a.adsquad) || [];
  }

  /**
   * Get a specific ad squad by ID
   */
  async get(adSquadId: string): Promise<AdSquad> {
    const response = await this.client.get<AdSquadResponse>(`/adsquads/${adSquadId}`);
    const adSquad = response.adsquads?.[0]?.adsquad;
    if (!adSquad) {
      throw new Error(`Ad squad ${adSquadId} not found`);
    }
    return adSquad;
  }

  /**
   * Create a new ad squad
   */
  async create(params: AdSquadCreateParams): Promise<AdSquad> {
    // Get the campaign to find the ad account ID
    const response = await this.client.post<AdSquadResponse>(
      `/campaigns/${params.campaign_id}/adsquads`,
      {
        adsquads: [params],
      }
    );
    const adSquad = response.adsquads?.[0]?.adsquad;
    if (!adSquad) {
      throw new Error('Failed to create ad squad');
    }
    return adSquad;
  }

  /**
   * Update an ad squad
   */
  async update(adSquadId: string, params: AdSquadUpdateParams): Promise<AdSquad> {
    const response = await this.client.put<AdSquadResponse>(
      `/adsquads/${adSquadId}`,
      {
        adsquads: [{ id: adSquadId, ...params }],
      }
    );
    const adSquad = response.adsquads?.[0]?.adsquad;
    if (!adSquad) {
      throw new Error('Failed to update ad squad');
    }
    return adSquad;
  }

  /**
   * Delete an ad squad
   */
  async delete(adSquadId: string): Promise<void> {
    await this.client.delete(`/adsquads/${adSquadId}`);
  }

  /**
   * Pause an ad squad
   */
  async pause(adSquadId: string): Promise<AdSquad> {
    return this.update(adSquadId, { status: 'PAUSED' });
  }

  /**
   * Activate an ad squad
   */
  async activate(adSquadId: string): Promise<AdSquad> {
    return this.update(adSquadId, { status: 'ACTIVE' });
  }

  /**
   * Update ad squad targeting
   */
  async updateTargeting(adSquadId: string, targeting: AdSquadUpdateParams['targeting']): Promise<AdSquad> {
    return this.update(adSquadId, { targeting });
  }

  /**
   * Update ad squad budget
   */
  async updateBudget(
    adSquadId: string,
    budget: { daily_budget_micro?: number; lifetime_budget_micro?: number }
  ): Promise<AdSquad> {
    return this.update(adSquadId, budget);
  }

  /**
   * Update ad squad bid
   */
  async updateBid(
    adSquadId: string,
    bid: { bid_micro?: number; auto_bid?: boolean }
  ): Promise<AdSquad> {
    return this.update(adSquadId, bid);
  }
}
