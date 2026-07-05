import type { UmamiConfig } from '../types';
import { UmamiClient } from './client';
import { AnalyticsApi } from './analytics';
import { TeamsApi } from './teams';
import { TeamsWebsitesApi, WebsitesApi } from './websites';

export class Umami {
  private readonly client: UmamiClient;

  public readonly websites: WebsitesApi;
  public readonly analytics: AnalyticsApi;
  public readonly teams: TeamsApi;
  public readonly teamWebsites: TeamsWebsitesApi;

  constructor(config: UmamiConfig) {
    this.client = new UmamiClient(config);
    this.websites = new WebsitesApi(this.client);
    this.analytics = new AnalyticsApi(this.client);
    this.teams = new TeamsApi(this.client);
    this.teamWebsites = new TeamsWebsitesApi(this.client);
  }

  static fromEnv(): Umami {
    const apiKey = process.env.UMAMI_API_KEY;
    if (!apiKey) {
      throw new Error('UMAMI_API_KEY environment variable is required');
    }

    const region = process.env.UMAMI_REGION?.toLowerCase();
    const normalizedRegion = region === 'us' || region === 'eu' ? region : undefined;

    return new Umami({
      apiKey,
      host: process.env.UMAMI_HOST,
      baseUrl: process.env.UMAMI_BASE_URL,
      region: normalizedRegion,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  getClient(): UmamiClient {
    return this.client;
  }
}

export { UmamiClient, buildBaseUrl, buildQueryParams } from './client';
export { WebsitesApi, TeamsWebsitesApi } from './websites';
export { AnalyticsApi } from './analytics';
export { TeamsApi } from './teams';
