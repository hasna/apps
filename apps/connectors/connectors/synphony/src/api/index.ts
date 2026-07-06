import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { SynphonyApi } from './synphony';

/**
 * Synphony API Connector.
 *
 * Provides access to a farm-robotics platform: farms, robots, telemetry,
 * harvest runs, and bed analytics.
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly synphony: SynphonyApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.synphony = new SynphonyApi(this.client);
  }

  /**
   * Create a connector from environment variables.
   * Reads SYNPHONY_API_KEY and, optionally, SYNPHONY_BASE_URL.
   */
  static fromEnv(): Connector {
    const apiKey = process.env.SYNPHONY_API_KEY;

    if (!apiKey) {
      throw new Error('SYNPHONY_API_KEY environment variable is required');
    }

    return new Connector({
      apiKey,
      baseUrl: process.env.SYNPHONY_BASE_URL,
    });
  }

  /** Get a preview of the API key (for debugging). */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /** Get the underlying client for direct API access. */
  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { SynphonyApi } from './synphony';
