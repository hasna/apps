import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { QueryRunsApi } from './query-runs';

export class Connector {
  private readonly client: ConnectorClient;
  public readonly queryRuns: QueryRunsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.queryRuns = new QueryRunsApi(this.client);
  }

  static fromApiKey(apiKey: string, options?: Omit<ConnectorConfig, 'apiKey'>): Connector {
    return new Connector({ apiKey, ...options });
  }

  static fromEnv(): Connector {
    const apiKey = process.env.STRIPE_SIGMA_API_KEY || process.env.STRIPE_API_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_SIGMA_API_KEY or STRIPE_API_KEY environment variable is required');
    }
    return new Connector({
      apiKey,
      baseUrl: process.env.STRIPE_SIGMA_BASE_URL || process.env.STRIPE_BASE_URL,
      accountId: process.env.STRIPE_SIGMA_ACCOUNT_ID || process.env.STRIPE_ACCOUNT_ID,
      apiVersion: process.env.STRIPE_SIGMA_API_VERSION || process.env.STRIPE_API_VERSION,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { QueryRunsApi } from './query-runs';
