import type { WistiaConfig } from '../types';
import { WistiaClient } from './client';
import { AccountApi } from './account';
import { ProjectsApi } from './projects';
import { MediasApi } from './medias';
import { CaptionsApi } from './captions';
import { ChannelsApi } from './channels';
import { StatsApi } from './stats';
import { SharingsApi } from './sharings';

/**
 * Wistia Data API client for video hosting, projects, medias, and analytics.
 */
export class Wistia {
  private readonly client: WistiaClient;

  public readonly account: AccountApi;
  public readonly projects: ProjectsApi;
  public readonly medias: MediasApi;
  public readonly captions: CaptionsApi;
  public readonly channels: ChannelsApi;
  public readonly stats: StatsApi;
  public readonly sharings: SharingsApi;

  constructor(config: WistiaConfig) {
    this.client = new WistiaClient(config);
    this.account = new AccountApi(this.client);
    this.projects = new ProjectsApi(this.client);
    this.medias = new MediasApi(this.client);
    this.captions = new CaptionsApi(this.client);
    this.channels = new ChannelsApi(this.client);
    this.stats = new StatsApi(this.client);
    this.sharings = new SharingsApi(this.client);
  }

  static fromEnv(): Wistia {
    const apiToken =
      process.env.WISTIA_API_TOKEN || process.env.WISTIA_API_KEY;

    if (!apiToken) {
      throw new Error('WISTIA_API_TOKEN or WISTIA_API_KEY environment variable is required');
    }

    return new Wistia({
      apiToken,
      baseUrl: process.env.WISTIA_BASE_URL,
    });
  }

  getApiTokenPreview(): string {
    return this.client.getApiTokenPreview();
  }

  getClient(): WistiaClient {
    return this.client;
  }
}

export { WistiaClient } from './client';
export { AccountApi } from './account';
export { ProjectsApi } from './projects';
export { MediasApi } from './medias';
export { CaptionsApi } from './captions';
export { ChannelsApi } from './channels';
export { StatsApi } from './stats';
export { SharingsApi } from './sharings';
