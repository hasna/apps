import type { BrandsightConfig } from '../types';
import { BrandsightClient } from './client';
import { DomainsApi } from './domains';

export class Brandsight {
  private readonly client: BrandsightClient;

  // API modules
  public readonly domains: DomainsApi;

  constructor(config: BrandsightConfig) {
    this.client = new BrandsightClient(config);
    this.domains = new DomainsApi(this.client);
  }

  /**
   * Create a Brandsight client from environment variables
   * Looks for BRANDSIGHT_API_KEY, BRANDSIGHT_API_SECRET, and optionally BRANDSIGHT_CUSTOMER_ID
   */
  static fromEnv(): Brandsight {
    const apiKey = process.env.BRANDSIGHT_API_KEY;
    const apiSecret = process.env.BRANDSIGHT_API_SECRET;
    const customerId = process.env.BRANDSIGHT_CUSTOMER_ID;

    if (!apiKey) {
      throw new Error('BRANDSIGHT_API_KEY environment variable is required');
    }
    if (!apiSecret) {
      throw new Error('BRANDSIGHT_API_SECRET environment variable is required');
    }
    return new Brandsight({ apiKey, apiSecret, customerId });
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
  getClient(): BrandsightClient {
    return this.client;
  }
}

export { BrandsightClient } from './client';
export { DomainsApi } from './domains';
