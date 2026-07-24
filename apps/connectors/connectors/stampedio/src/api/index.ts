import type { StampedioConfig } from '../types';
import { StampedioClient } from './client';
import { ReviewsApi } from './reviews';
import { CustomersApi } from './customers';
import { LoyaltyApi } from './loyalty';

/**
 * Main Stamped.io connector.
 * Provides access to Reviews, Customers, and Loyalty APIs.
 */
export class Stampedio {
  private readonly client: StampedioClient;

  public readonly reviews: ReviewsApi;
  public readonly customers: CustomersApi;
  public readonly loyalty: LoyaltyApi;

  constructor(config: StampedioConfig) {
    this.client = new StampedioClient(config);
    this.reviews = new ReviewsApi(this.client);
    this.customers = new CustomersApi(this.client);
    this.loyalty = new LoyaltyApi(this.client);
  }

  /**
   * Create a connector from environment variables.
   * Reads STAMPEDIO_PRIVATE_KEY, STAMPEDIO_STORE_HASH,
   * and optionally STAMPEDIO_STORE_URL.
   */
  static fromEnv(): Stampedio {
    const publicKey = process.env.STAMPEDIO_PUBLIC_KEY;
    const privateKey = process.env.STAMPEDIO_PRIVATE_KEY;
    const storeHash = process.env.STAMPEDIO_STORE_HASH;
    const storeUrl = process.env.STAMPEDIO_STORE_URL;

    if (!privateKey) throw new Error('STAMPEDIO_PRIVATE_KEY environment variable is required');
    if (!storeHash) throw new Error('STAMPEDIO_STORE_HASH environment variable is required');

    return new Stampedio({ publicKey, privateKey, storeHash, storeUrl });
  }

  /** Get the underlying HTTP client for direct API access. */
  getClient(): StampedioClient {
    return this.client;
  }
}

export { StampedioClient } from './client';
export { ReviewsApi } from './reviews';
export { CustomersApi } from './customers';
export { LoyaltyApi } from './loyalty';
