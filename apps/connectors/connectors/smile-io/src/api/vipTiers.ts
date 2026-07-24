import type { SmileClient } from './client';
import type { ListVipTiersOptions, ListVipTiersResponse, VipTier } from '../types';

/**
 * VIP Tiers API — the program's VIP levels.
 * Endpoint: GET /vip_tiers
 */
export class VipTiersApi {
  constructor(private readonly client: SmileClient) {}

  /**
   * List VIP tiers (sorted ascending by milestone, no pagination).
   * `include` accepts `perks` and/or `entry_rewards`.
   */
  async list(options: ListVipTiersOptions = {}): Promise<VipTier[]> {
    const response = await this.client.request<ListVipTiersResponse>('/vip_tiers', {
      params: { include: options.include },
    });
    return response.vip_tiers;
  }
}
