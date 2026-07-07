import type { TikTokAdsConfig } from '../types';
import { TikTokAdsClient } from './client';
import { AdvertisersApi } from './advertisers';
import { CampaignsApi } from './campaigns';
import { AdGroupsApi } from './adgroups';
import { AdsApi } from './ads';
import { ReportsApi } from './reports';
import { PixelsApi } from './pixels';
import { FilesApi } from './files';

export class TikTokAds {
  private readonly client: TikTokAdsClient;

  public advertisers: AdvertisersApi;
  public campaigns: CampaignsApi;
  public adGroups: AdGroupsApi;
  public ads: AdsApi;
  public reports: ReportsApi;
  public pixels: PixelsApi;
  public files: FilesApi;

  constructor(config: TikTokAdsConfig) {
    this.client = new TikTokAdsClient(config);
    this.advertisers = new AdvertisersApi(this.client);
    this.campaigns = new CampaignsApi(this.client);
    this.adGroups = new AdGroupsApi(this.client);
    this.ads = new AdsApi(this.client);
    this.reports = new ReportsApi(this.client);
    this.pixels = new PixelsApi(this.client);
    this.files = new FilesApi(this.client);
  }

  static fromEnv(): TikTokAds {
    const accessToken = process.env.TIKTOK_ADS_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('TIKTOK_ADS_ACCESS_TOKEN environment variable is required');
    }
    return new TikTokAds({
      accessToken,
      advertiserId: process.env.TIKTOK_ADS_ADVERTISER_ID,
    });
  }

  async rawRequest<T = unknown>(path: string, options?: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    params?: Record<string, string | number | boolean | string[] | undefined>;
    body?: Record<string, unknown> | unknown[] | string | object;
  }): Promise<T> {
    return this.client.request<T>(path, options || {});
  }

  getClient(): TikTokAdsClient {
    return this.client;
  }
}

export { TikTokAdsClient } from './client';
export { AdvertisersApi } from './advertisers';
export { CampaignsApi } from './campaigns';
export { AdGroupsApi } from './adgroups';
export { AdsApi } from './ads';
export { ReportsApi } from './reports';
export { PixelsApi } from './pixels';
export { FilesApi } from './files';
