import type { SnapConfig } from '../types';
import { SnapClient } from './client';
import { OrganizationsApi } from './organizations';
import { AccountsApi } from './accounts';
import { CampaignsApi } from './campaigns';
import { AdSquadsApi } from './adsquads';
import { AdsApi } from './ads';
import { CreativesApi } from './creatives';
import { MediaApi } from './media';
import { AudiencesApi } from './audiences';
import { TargetingApi } from './targeting';
import { StatsApi } from './stats';
import { PixelsApi } from './pixels';
import { ConversionsApi } from './conversions';
import { CatalogsApi } from './catalogs';
import { LeadsApi } from './leads';

/**
 * Snapchat Marketing API client
 * Provides access to all Snapchat Ads API endpoints
 */
export class Snap {
  private readonly client: SnapClient;

  // API modules
  public readonly organizations: OrganizationsApi;
  public readonly accounts: AccountsApi;
  public readonly campaigns: CampaignsApi;
  public readonly adSquads: AdSquadsApi;
  public readonly ads: AdsApi;
  public readonly creatives: CreativesApi;
  public readonly media: MediaApi;
  public readonly audiences: AudiencesApi;
  public readonly targeting: TargetingApi;
  public readonly stats: StatsApi;
  public readonly pixels: PixelsApi;
  public readonly conversions: ConversionsApi;
  public readonly catalogs: CatalogsApi;
  public readonly leads: LeadsApi;

  constructor(config: SnapConfig) {
    this.client = new SnapClient(config);
    this.organizations = new OrganizationsApi(this.client);
    this.accounts = new AccountsApi(this.client);
    this.campaigns = new CampaignsApi(this.client);
    this.adSquads = new AdSquadsApi(this.client);
    this.ads = new AdsApi(this.client);
    this.creatives = new CreativesApi(this.client);
    this.media = new MediaApi(this.client);
    this.audiences = new AudiencesApi(this.client);
    this.targeting = new TargetingApi(this.client);
    this.stats = new StatsApi(this.client);
    this.pixels = new PixelsApi(this.client);
    this.conversions = new ConversionsApi(this.client);
    this.catalogs = new CatalogsApi(this.client);
    this.leads = new LeadsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for SNAP_ACCESS_TOKEN, SNAP_REFRESH_TOKEN, SNAP_CLIENT_ID, SNAP_CLIENT_SECRET
   */
  static fromEnv(): Snap {
    const accessToken = process.env.SNAP_ACCESS_TOKEN;
    const refreshToken = process.env.SNAP_REFRESH_TOKEN;
    const clientId = process.env.SNAP_CLIENT_ID;
    const clientSecret = process.env.SNAP_CLIENT_SECRET;

    if (!accessToken) {
      throw new Error('SNAP_ACCESS_TOKEN environment variable is required');
    }

    return new Snap({
      accessToken,
      refreshToken,
      clientId,
      clientSecret,
    });
  }

  /**
   * Refresh the access token
   */
  async refreshToken(): Promise<void> {
    await this.client.refreshAccessToken();
  }

  /**
   * Check if the client can refresh tokens
   */
  canRefreshToken(): boolean {
    return this.client.canRefreshToken();
  }

  /**
   * Get a preview of the access token (for debugging)
   */
  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): SnapClient {
    return this.client;
  }
}

export { SnapClient, exchangeCodeForTokens, generateAuthUrl } from './client';
export { OrganizationsApi } from './organizations';
export { AccountsApi } from './accounts';
export { CampaignsApi } from './campaigns';
export { AdSquadsApi } from './adsquads';
export { AdsApi } from './ads';
export { CreativesApi } from './creatives';
export { MediaApi } from './media';
export { AudiencesApi } from './audiences';
export { TargetingApi } from './targeting';
export { StatsApi } from './stats';
export { PixelsApi } from './pixels';
export { ConversionsApi } from './conversions';
export { CatalogsApi } from './catalogs';
export { LeadsApi } from './leads';
