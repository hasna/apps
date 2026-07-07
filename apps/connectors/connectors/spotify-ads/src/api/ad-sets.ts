import type { SpotifyAdsClient } from './client';
import type { AdSet, AdSetsResponse, ListQueryParams } from '../types';

export class AdSetsApi {
  constructor(private readonly client: SpotifyAdsClient) {}

  async list(adAccountId: string, params?: ListQueryParams): Promise<AdSetsResponse> {
    return this.client.get<AdSetsResponse>(`/ad_accounts/${adAccountId}/ad_sets`, params);
  }

  async get(adAccountId: string, adSetId: string): Promise<AdSet> {
    return this.client.get<AdSet>(`/ad_accounts/${adAccountId}/ad_sets/${adSetId}`);
  }
}
