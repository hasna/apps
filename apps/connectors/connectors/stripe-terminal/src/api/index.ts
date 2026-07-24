import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ConnectionTokensApi } from './connection-tokens';
import { LocationsApi } from './locations';
import { ReadersApi } from './readers';
import { ConfigurationsApi } from './configurations';

/**
 * Stripe Terminal API Connector
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly connectionTokens: ConnectionTokensApi;
  public readonly locations: LocationsApi;
  public readonly readers: ReadersApi;
  public readonly configurations: ConfigurationsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.connectionTokens = new ConnectionTokensApi(this.client);
    this.locations = new LocationsApi(this.client);
    this.readers = new ReadersApi(this.client);
    this.configurations = new ConfigurationsApi(this.client);
  }

  static fromApiKey(apiKey: string, options?: Omit<ConnectorConfig, 'apiKey'>): Connector {
    return new Connector({ apiKey, ...options });
  }

  static fromEnv(): Connector {
    const apiKey = process.env.STRIPE_TERMINAL_API_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_TERMINAL_API_KEY environment variable is required');
    }
    return new Connector({
      apiKey,
      baseUrl: process.env.STRIPE_TERMINAL_BASE_URL,
      accountId: process.env.STRIPE_TERMINAL_ACCOUNT_ID,
      apiVersion: process.env.STRIPE_TERMINAL_API_VERSION,
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
export { ConnectionTokensApi } from './connection-tokens';
export { LocationsApi } from './locations';
export { ReadersApi } from './readers';
export { ConfigurationsApi } from './configurations';
