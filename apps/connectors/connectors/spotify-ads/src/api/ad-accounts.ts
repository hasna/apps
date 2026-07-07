import type { SpotifyAdsClient } from './client';
import type { AdAccount, AdAccountsResponse } from '../types';

export class AdAccountsApi {
  constructor(private readonly client: SpotifyAdsClient) {}

  async listByBusiness(businessId: string): Promise<AdAccountsResponse> {
    return this.client.get<AdAccountsResponse>(`/businesses/${businessId}/ad_accounts`);
  }

  async get(adAccountId: string): Promise<AdAccount> {
    return this.client.get<AdAccount>(`/ad_accounts/${adAccountId}`);
  }
}
