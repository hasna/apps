import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ProjectsApi } from './projects';
import {
  CampaignsApi,
  ContentsApi,
  MediumsApi,
  SourcesApi,
  TermsApi,
} from './campaigns';
import { LinksApi } from './links';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly projects: ProjectsApi;
  public readonly campaigns: CampaignsApi;
  public readonly contents: ContentsApi;
  public readonly mediums: MediumsApi;
  public readonly sources: SourcesApi;
  public readonly terms: TermsApi;
  public readonly links: LinksApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.projects = new ProjectsApi(this.client);
    this.campaigns = new CampaignsApi(this.client);
    this.contents = new ContentsApi(this.client);
    this.mediums = new MediumsApi(this.client);
    this.sources = new SourcesApi(this.client);
    this.terms = new TermsApi(this.client);
    this.links = new LinksApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.TERMINUS_API_KEY || process.env.TERMINUS_TOKEN;
    if (!apiKey) {
      throw new Error('TERMINUS_API_KEY environment variable is required');
    }
    return new Connector({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }

  async rawRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options?: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | string;
    }
  ): Promise<T> {
    return this.client.request<T>(path, {
      method,
      params: options?.params,
      body: options?.body,
    });
  }
}

export { ConnectorClient } from './client';
export { ProjectsApi } from './projects';
export {
  CampaignsApi,
  ContentsApi,
  MediumsApi,
  SourcesApi,
  TermsApi,
  UtmValuesApi,
} from './campaigns';
export { LinksApi } from './links';
