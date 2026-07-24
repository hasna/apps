import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ModulesApi } from './modules';
import { RelatedApi } from './related';
import { MetadataApi } from './metadata';
import { AuthApi } from './auth';
import { UserApi } from './user';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly modules: ModulesApi;
  public readonly related: RelatedApi;
  public readonly metadata: MetadataApi;
  public readonly auth: AuthApi;
  public readonly user: UserApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.modules = new ModulesApi(this.client);
    this.related = new RelatedApi(this.client);
    this.metadata = new MetadataApi(this.client);
    this.auth = new AuthApi(this.client);
    this.user = new UserApi(this.client);
  }

  static fromEnv(): Connector {
    const oauthToken =
      process.env.SUGARCRM_OAUTH_TOKEN ||
      process.env.SUGARCRM_API_KEY ||
      process.env.SUGARCRM_TOKEN;
    const baseUrl = process.env.SUGARCRM_BASE_URL;

    if (!oauthToken) {
      throw new Error('SUGARCRM_OAUTH_TOKEN environment variable is required');
    }
    if (!baseUrl) {
      throw new Error('SUGARCRM_BASE_URL environment variable is required');
    }

    return new Connector({
      oauthToken,
      baseUrl,
      clientId: process.env.SUGARCRM_CLIENT_ID,
      clientSecret: process.env.SUGARCRM_CLIENT_SECRET,
    });
  }

  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { ModulesApi } from './modules';
export { RelatedApi } from './related';
export { MetadataApi } from './metadata';
export { AuthApi } from './auth';
export { UserApi } from './user';
