import type { HeyGenConfig } from '../types';
import { HeyGenClient } from './client';
import { ExampleApi } from './example';

/**
 * Main HeyGen API client class
 */
export class HeyGen {
  private readonly client: HeyGenClient;

  // API modules - add more as needed
  public readonly example: ExampleApi;

  constructor(config: HeyGenConfig) {
    this.client = new HeyGenClient(config);
    this.example = new ExampleApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for HEYGEN_API_KEY and optionally HEYGEN_API_SECRET
   */
  static fromEnv(): HeyGen {
    const apiKey = process.env.HEYGEN_API_KEY;
    const apiSecret = process.env.HEYGEN_API_SECRET;

    if (!apiKey) {
      throw new Error('HEYGEN_API_KEY environment variable is required');
    }
    return new HeyGen({ apiKey, apiSecret });
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
  getClient(): HeyGenClient {
    return this.client;
  }
}

export { HeyGenClient } from './client';
export { ExampleApi } from './example';
