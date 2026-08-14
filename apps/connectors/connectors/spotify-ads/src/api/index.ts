import type { ConnectorConfig } from '../types';
import { SpotifyAdsClient } from './client';
import { BusinessesApi } from './businesses';
import { AdAccountsApi } from './ad-accounts';
import { CampaignsApi } from './campaigns';
import { AdSetsApi } from './ad-sets';
import { AdsApi } from './ads';

export class SpotifyAds {
  private readonly client: SpotifyAdsClient;

  public readonly businesses: BusinessesApi;
  public readonly adAccounts: AdAccountsApi;
  public readonly campaigns: CampaignsApi;
  public readonly adSets: AdSetsApi;
  public readonly ads: AdsApi;

  constructor(config: ConnectorConfig) {
    this.client = new SpotifyAdsClient(config);
    this.businesses = new BusinessesApi(this.client);
    this.adAccounts = new AdAccountsApi(this.client);
    this.campaigns = new CampaignsApi(this.client);
    this.adSets = new AdSetsApi(this.client);
    this.ads = new AdsApi(this.client);
  }

  static fromEnv(): SpotifyAds {
    const accessToken = process.env.SPOTIFY_ADS_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('SPOTIFY_ADS_ACCESS_TOKEN environment variable is required');
    }

    return new SpotifyAds({
      accessToken,
      baseUrl: process.env.SPOTIFY_ADS_BASE_URL,
    });
  }

  async raw<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options?: {
      params?: Record<string, string | number | boolean | string[] | undefined>;
      body?: Record<string, unknown>;
    }
  ): Promise<T> {
    return this.client.request<T>(path, {
      method,
      params: options?.params,
      body: options?.body,
    });
  }

  getClient(): SpotifyAdsClient {
    return this.client;
  }
}

export { SpotifyAdsClient, DEFAULT_BASE_URL } from './client';
export { BusinessesApi } from './businesses';
export { AdAccountsApi } from './ad-accounts';
export { CampaignsApi } from './campaigns';
export { AdSetsApi } from './ad-sets';
export { AdsApi } from './ads';
