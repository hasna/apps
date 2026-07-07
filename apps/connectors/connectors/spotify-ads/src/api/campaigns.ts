import type { SpotifyAdsClient } from './client';
import type {
  Campaign,
  CampaignCreateParams,
  CampaignsResponse,
  ListQueryParams,
} from '../types';

export class CampaignsApi {
  constructor(private readonly client: SpotifyAdsClient) {}

  async list(adAccountId: string, params?: ListQueryParams): Promise<CampaignsResponse> {
    return this.client.get<CampaignsResponse>(`/ad_accounts/${adAccountId}/campaigns`, params);
  }

  async get(adAccountId: string, campaignId: string): Promise<Campaign> {
    return this.client.get<Campaign>(`/ad_accounts/${adAccountId}/campaigns/${campaignId}`);
  }

  async create(adAccountId: string, data: CampaignCreateParams): Promise<Campaign> {
    return this.client.post<Campaign>(`/ad_accounts/${adAccountId}/campaigns`, data);
  }
}
