import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { AssetsApi } from './assets';
import { OperationsApi } from './operations';
import { JobsApi } from './jobs';

export class Connector {
  private readonly client: ConnectorClient;
  public readonly assets: AssetsApi;
  public readonly operations: OperationsApi;
  public readonly jobs: JobsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.assets = new AssetsApi(this.client);
    this.operations = new OperationsApi(this.client);
    this.jobs = new JobsApi(this.client);
  }

  /**
   * Create from environment variables
   * ADOBE_CLIENT_ID (client_id / x-api-key)
   * ADOBE_CLIENT_SECRET (client_secret for OAuth2 token exchange)
   * ADOBE_REGION (optional: 'us' or 'eu', default 'us')
   */
  static fromEnv(): Connector {
    const apiKey = process.env.ADOBE_CLIENT_ID;
    const apiSecret = process.env.ADOBE_CLIENT_SECRET;

    if (!apiKey) {
      throw new Error('ADOBE_CLIENT_ID environment variable is required');
    }
    return new Connector({ apiKey, apiSecret, region: (process.env.ADOBE_REGION as 'us' | 'eu') || 'us' });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { AssetsApi } from './assets';
export { OperationsApi } from './operations';
export { JobsApi } from './jobs';
