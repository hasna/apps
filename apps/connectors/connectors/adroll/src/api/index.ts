import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { OrganizationsApi } from './organizations';
import { AdvertisablesApi } from './advertisables';
import { CampaignsApi } from './campaigns';
import { AdgroupsApi } from './adgroups';
import { AdsApi } from './ads';
import { SegmentsApi } from './segments';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly organizations: OrganizationsApi;
  public readonly advertisables: AdvertisablesApi;
  public readonly campaigns: CampaignsApi;
  public readonly adgroups: AdgroupsApi;
  public readonly ads: AdsApi;
  public readonly segments: SegmentsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.organizations = new OrganizationsApi(this.client);
    this.advertisables = new AdvertisablesApi(this.client);
    this.campaigns = new CampaignsApi(this.client);
    this.adgroups = new AdgroupsApi(this.client);
    this.ads = new AdsApi(this.client);
    this.segments = new SegmentsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.ADROLL_API_KEY || process.env.ADROLL_TOKEN;

    if (!apiKey) {
      throw new Error('ADROLL_API_KEY environment variable is required');
    }
    return new Connector({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { OrganizationsApi } from './organizations';
export { AdvertisablesApi } from './advertisables';
export { CampaignsApi } from './campaigns';
export { AdgroupsApi } from './adgroups';
export { AdsApi } from './ads';
export { SegmentsApi } from './segments';
