import type { TikTokConfig } from '../types';
import { TikTokClient } from './client';
import { AdvertisersApi } from './advertisers';
import { CampaignsApi } from './campaigns';
import { AdGroupsApi } from './adgroups';
import { AdsApi } from './ads';
import { CreativesApi } from './creatives';
import { AudiencesApi } from './audiences';
import { TargetingApi } from './targeting';
import { ReportsApi } from './reports';
import { BusinessApi } from './business';
import { PixelsApi } from './pixels';
import { EventsApi } from './events';
import { CatalogsApi } from './catalogs';
import { IdentityApi } from './identity';

/**
 * TikTok Marketing API client
 * Provides access to all TikTok Marketing API endpoints
 */
export class TikTok {
  private readonly client: TikTokClient;

  // API modules
  public readonly advertisers: AdvertisersApi;
  public readonly campaigns: CampaignsApi;
  public readonly adgroups: AdGroupsApi;
  public readonly ads: AdsApi;
  public readonly creatives: CreativesApi;
  public readonly audiences: AudiencesApi;
  public readonly targeting: TargetingApi;
  public readonly reports: ReportsApi;
  public readonly business: BusinessApi;
  public readonly pixels: PixelsApi;
  public readonly events: EventsApi;
  public readonly catalogs: CatalogsApi;
  public readonly identity: IdentityApi;

  constructor(config: TikTokConfig) {
    this.client = new TikTokClient(config);
    this.advertisers = new AdvertisersApi(this.client);
    this.campaigns = new CampaignsApi(this.client);
    this.adgroups = new AdGroupsApi(this.client);
    this.ads = new AdsApi(this.client);
    this.creatives = new CreativesApi(this.client);
    this.audiences = new AudiencesApi(this.client);
    this.targeting = new TargetingApi(this.client);
    this.reports = new ReportsApi(this.client);
    this.business = new BusinessApi(this.client);
    this.pixels = new PixelsApi(this.client);
    this.events = new EventsApi(this.client);
    this.catalogs = new CatalogsApi(this.client);
    this.identity = new IdentityApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for TIKTOK_ACCESS_TOKEN and optionally TIKTOK_ADVERTISER_ID
   */
  static fromEnv(): TikTok {
    const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
    const advertiserId = process.env.TIKTOK_ADVERTISER_ID;

    if (!accessToken) {
      throw new Error('TIKTOK_ACCESS_TOKEN environment variable is required');
    }
    return new TikTok({ accessToken, advertiserId });
  }

  /**
   * Get a preview of the access token (for debugging)
   */
  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  /**
   * Get the default advertiser ID configured in the client
   */
  getDefaultAdvertiserId(): string | undefined {
    return this.client.getDefaultAdvertiserId();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): TikTokClient {
    return this.client;
  }
}

export { TikTokClient } from './client';
export { AdvertisersApi } from './advertisers';
export { CampaignsApi } from './campaigns';
export { AdGroupsApi } from './adgroups';
export { AdsApi } from './ads';
export { CreativesApi } from './creatives';
export { AudiencesApi } from './audiences';
export { TargetingApi } from './targeting';
export { ReportsApi } from './reports';
export { BusinessApi } from './business';
export { PixelsApi } from './pixels';
export { EventsApi } from './events';
export { CatalogsApi } from './catalogs';
export { IdentityApi } from './identity';
