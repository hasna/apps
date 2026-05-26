import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { MonitoringApi } from './monitoring';
import { IntelligenceApi } from './intelligence';

/**
 * Brandsight API Connector class
 */
export class Connector {
  private readonly client: ConnectorClient;

  // API modules
  public readonly monitoring: MonitoringApi;
  public readonly intelligence: IntelligenceApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.monitoring = new MonitoringApi(this.client);
    this.intelligence = new IntelligenceApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for BRANDSIGHT_API_KEY
   */
  static fromEnv(): Connector {
    const apiKey = process.env.BRANDSIGHT_API_KEY;

    if (!apiKey) {
      throw new Error('BRANDSIGHT_API_KEY environment variable is required');
    }

    return new Connector({ apiKey });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): ConnectorClient {
    return this.client;
  }
}

// Export client and all API classes
export { ConnectorClient } from './client';
export { MonitoringApi } from './monitoring';
export { IntelligenceApi } from './intelligence';
