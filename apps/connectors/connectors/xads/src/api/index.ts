import { XAdsClient, type XAdsClientConfig } from './client';
import { AccountsApi } from './accounts';
import { CampaignsApi } from './campaigns';
import { LineItemsApi } from './line-items';
import { PromotedTweetsApi } from './promoted-tweets';
import { TargetingApi } from './targeting';
import { AudiencesApi } from './audiences';
import { AnalyticsApi } from './analytics';
import { MediaApi } from './media';

/**
 * Main X Ads Connector class
 * Provides access to all Twitter/X Ads API endpoints
 */
export class XAds {
  private readonly client: XAdsClient;

  // API modules
  public readonly accounts: AccountsApi;
  public readonly campaigns: CampaignsApi;
  public readonly lineItems: LineItemsApi;
  public readonly promotedTweets: PromotedTweetsApi;
  public readonly targeting: TargetingApi;
  public readonly audiences: AudiencesApi;
  public readonly analytics: AnalyticsApi;
  public readonly media: MediaApi;

  constructor(config: XAdsClientConfig) {
    this.client = new XAdsClient(config);
    this.accounts = new AccountsApi(this.client);
    this.campaigns = new CampaignsApi(this.client);
    this.lineItems = new LineItemsApi(this.client);
    this.promotedTweets = new PromotedTweetsApi(this.client);
    this.targeting = new TargetingApi(this.client);
    this.audiences = new AudiencesApi(this.client);
    this.analytics = new AnalyticsApi(this.client);
    this.media = new MediaApi(this.client);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): XAds {
    const consumerKey = process.env.X_ADS_CONSUMER_KEY;
    const consumerSecret = process.env.X_ADS_CONSUMER_SECRET;
    const accessToken = process.env.X_ADS_ACCESS_TOKEN;
    const accessTokenSecret = process.env.X_ADS_ACCESS_TOKEN_SECRET;

    if (!consumerKey || !consumerSecret) {
      throw new Error('X_ADS_CONSUMER_KEY and X_ADS_CONSUMER_SECRET environment variables are required');
    }

    return new XAds({
      consumerKey,
      consumerSecret,
      accessToken,
      accessTokenSecret,
    });
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): XAdsClient {
    return this.client;
  }

  /**
   * Get base URL
   */
  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  /**
   * Check if user tokens are configured
   */
  hasUserTokens(): boolean {
    return this.client.hasUserTokens();
  }
}

export { XAdsClient } from './client';
export { AccountsApi } from './accounts';
export { CampaignsApi } from './campaigns';
export { LineItemsApi } from './line-items';
export { PromotedTweetsApi } from './promoted-tweets';
export { TargetingApi } from './targeting';
export { AudiencesApi } from './audiences';
export { AnalyticsApi } from './analytics';
export { MediaApi } from './media';
