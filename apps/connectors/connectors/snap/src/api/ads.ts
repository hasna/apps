import type { SnapClient } from './client';
import type {
  Ad,
  AdCreateParams,
  AdUpdateParams,
  AdResponse,
} from '../types';

/**
 * Snapchat Ads API
 * Manage individual ads
 */
export class AdsApi {
  constructor(private readonly client: SnapClient) {}

  /**
   * List all ads for an ad account
   */
  async listByAccount(adAccountId: string): Promise<Ad[]> {
    const response = await this.client.get<AdResponse>(
      `/adaccounts/${adAccountId}/ads`
    );
    return response.ads?.map(a => a.ad) || [];
  }

  /**
   * List all ads for an ad squad
   */
  async listByAdSquad(adSquadId: string): Promise<Ad[]> {
    const response = await this.client.get<AdResponse>(
      `/adsquads/${adSquadId}/ads`
    );
    return response.ads?.map(a => a.ad) || [];
  }

  /**
   * Get a specific ad by ID
   */
  async get(adId: string): Promise<Ad> {
    const response = await this.client.get<AdResponse>(`/ads/${adId}`);
    const ad = response.ads?.[0]?.ad;
    if (!ad) {
      throw new Error(`Ad ${adId} not found`);
    }
    return ad;
  }

  /**
   * Create a new ad
   */
  async create(params: AdCreateParams): Promise<Ad> {
    const response = await this.client.post<AdResponse>(
      `/adsquads/${params.ad_squad_id}/ads`,
      {
        ads: [params],
      }
    );
    const ad = response.ads?.[0]?.ad;
    if (!ad) {
      throw new Error('Failed to create ad');
    }
    return ad;
  }

  /**
   * Update an ad
   */
  async update(adId: string, params: AdUpdateParams): Promise<Ad> {
    const response = await this.client.put<AdResponse>(
      `/ads/${adId}`,
      {
        ads: [{ id: adId, ...params }],
      }
    );
    const ad = response.ads?.[0]?.ad;
    if (!ad) {
      throw new Error('Failed to update ad');
    }
    return ad;
  }

  /**
   * Delete an ad
   */
  async delete(adId: string): Promise<void> {
    await this.client.delete(`/ads/${adId}`);
  }

  /**
   * Pause an ad
   */
  async pause(adId: string): Promise<Ad> {
    return this.update(adId, { status: 'PAUSED' });
  }

  /**
   * Activate an ad
   */
  async activate(adId: string): Promise<Ad> {
    return this.update(adId, { status: 'ACTIVE' });
  }
}
