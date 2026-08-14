import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { TenorApi } from './tenor';

/**
 * Tenor API Connector
 * Search and discover GIFs, stickers, categories, and trending terms via
 * Google's Tenor v2 API.
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly tenor: TenorApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.tenor = new TenorApi(this.client);
  }

  /**
   * Create a client from environment variables.
   * Looks for TENOR_API_KEY and optionally TENOR_CLIENT_KEY.
   */
  static fromEnv(): Connector {
    const apiKey = process.env.TENOR_API_KEY;
    const clientKey = process.env.TENOR_CLIENT_KEY;
    const baseUrl = process.env.TENOR_BASE_URL;

    if (!apiKey) {
      throw new Error('TENOR_API_KEY environment variable is required');
    }
    return new Connector({ apiKey, clientKey, baseUrl });
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
export { TenorApi } from './tenor';
