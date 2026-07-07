import type { SpotifyAdsClient } from './client';
import type { Ad, AdsResponse, ListQueryParams } from '../types';

export class AdsApi {
  constructor(private readonly client: SpotifyAdsClient) {}

  async list(adAccountId: string, params?: ListQueryParams): Promise<AdsResponse> {
    return this.client.get<AdsResponse>(`/ad_accounts/${adAccountId}/ads`, params);
  }

  async get(adAccountId: string, adId: string): Promise<Ad> {
    return this.client.get<Ad>(`/ad_accounts/${adAccountId}/ads/${adId}`);
  }
}
