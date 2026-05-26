import type { MetaConfig } from '../types';
import { MetaClient } from './client';
import { AccountsApi } from './accounts';
import { CampaignsApi } from './campaigns';
import { AdSetsApi } from './adsets';
import { AdsApi } from './ads';
import { CreativesApi } from './creatives';
import { AudiencesApi } from './audiences';
import { InsightsApi } from './insights';
import { PagesApi } from './pages';
import { InstagramApi } from './instagram';
import { PixelsApi } from './pixels';
import { CatalogsApi } from './catalogs';
import { BusinessApi } from './business';

/**
 * Meta Marketing API client
 * Provides access to all Meta/Facebook Marketing API endpoints
 */
export class Meta {
  private readonly client: MetaClient;

  // API modules
  public readonly accounts: AccountsApi;
  public readonly campaigns: CampaignsApi;
  public readonly adsets: AdSetsApi;
  public readonly ads: AdsApi;
  public readonly creatives: CreativesApi;
  public readonly audiences: AudiencesApi;
  public readonly insights: InsightsApi;
  public readonly pages: PagesApi;
  public readonly instagram: InstagramApi;
  public readonly pixels: PixelsApi;
  public readonly catalogs: CatalogsApi;
  public readonly business: BusinessApi;

  constructor(config: MetaConfig) {
    this.client = new MetaClient(config);
    this.accounts = new AccountsApi(this.client);
    this.campaigns = new CampaignsApi(this.client);
    this.adsets = new AdSetsApi(this.client);
    this.ads = new AdsApi(this.client);
    this.creatives = new CreativesApi(this.client);
    this.audiences = new AudiencesApi(this.client);
    this.insights = new InsightsApi(this.client);
    this.pages = new PagesApi(this.client);
    this.instagram = new InstagramApi(this.client);
    this.pixels = new PixelsApi(this.client);
    this.catalogs = new CatalogsApi(this.client);
    this.business = new BusinessApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for META_ACCESS_TOKEN
   */
  static fromEnv(): Meta {
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!accessToken) {
      throw new Error('META_ACCESS_TOKEN environment variable is required');
    }
    return new Meta({ accessToken });
  }

  /**
   * Get a preview of the access token (for debugging)
   */
  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  /**
   * Get API version
   */
  getApiVersion(): string {
    return this.client.getApiVersion();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): MetaClient {
    return this.client;
  }
}

export { MetaClient } from './client';
export { AccountsApi } from './accounts';
export { CampaignsApi } from './campaigns';
export { AdSetsApi } from './adsets';
export { AdsApi } from './ads';
export { CreativesApi } from './creatives';
export { AudiencesApi } from './audiences';
export { InsightsApi } from './insights';
export { PagesApi } from './pages';
export { InstagramApi } from './instagram';
export { PixelsApi } from './pixels';
export { CatalogsApi } from './catalogs';
export { BusinessApi } from './business';
