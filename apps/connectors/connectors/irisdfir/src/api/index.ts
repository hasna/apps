import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ExampleApi } from './example';

/**
 * Main Connector class
 * TODO: Rename to your API name (e.g., Perplexity, Twitter, etc.)
 */
export class Connector {
  private readonly client: ConnectorClient;

  // API modules - add more as needed
  public readonly example: ExampleApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.example = new ExampleApi(this.client);
  }

  /**
   * Create a client from environment variables
   * TODO: Update env var names for your API
   * Looks for CONNECTOR_API_KEY and optionally CONNECTOR_API_SECRET
   */
  static fromEnv(): Connector {
    const apiKey = process.env.CONNECTOR_API_KEY;
    const apiSecret = process.env.CONNECTOR_API_SECRET;

    if (!apiKey) {
      throw new Error('CONNECTOR_API_KEY environment variable is required');
    }
    return new Connector({ apiKey, apiSecret });
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

export { ConnectorClient } from './client';
export { ExampleApi } from './example';
