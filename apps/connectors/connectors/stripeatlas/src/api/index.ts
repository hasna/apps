import type { StripeAtlasConfig, ConnectorConfig } from '../types';
import { StripeAtlasClient } from './client';
import { StripeAtlasApi } from './example';

/**
 * Stripe Atlas Connector
 * Uses browser automation since Stripe Atlas doesn't have a public API
 */
export class StripeAtlas {
  private readonly client: StripeAtlasClient;

  // API modules
  public readonly atlas: StripeAtlasApi;

  constructor(config: StripeAtlasConfig | ConnectorConfig) {
    // Handle both new config format and legacy apiKey format
    const email = 'email' in config ? config.email : config.apiKey;
    const password = 'password' in config ? config.password : config.apiSecret;

    if (!email) {
      throw new Error('Email is required for Stripe Atlas');
    }

    this.client = new StripeAtlasClient({ email, password, baseUrl: config.baseUrl });
    this.atlas = new StripeAtlasApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for STRIPE_ATLAS_EMAIL and STRIPE_ATLAS_PASSWORD
   */
  static fromEnv(): StripeAtlas {
    const email = process.env.STRIPE_ATLAS_EMAIL;
    const password = process.env.STRIPE_ATLAS_PASSWORD;

    if (!email) {
      throw new Error('STRIPE_ATLAS_EMAIL environment variable is required');
    }
    return new StripeAtlas({ email, password });
  }

  /**
   * Get a preview of the email (for debugging)
   */
  getEmailPreview(): string {
    return this.client.getEmailPreview();
  }

  // Alias for backwards compatibility
  getApiKeyPreview(): string {
    return this.getEmailPreview();
  }

  /**
   * Get the underlying client for direct access
   */
  getClient(): StripeAtlasClient {
    return this.client;
  }
}

// Aliases for backwards compatibility with scaffold patterns
export { StripeAtlas as Connector };
export { StripeAtlasClient as ConnectorClient } from './client';
export { StripeAtlasApi as ExampleApi } from './example';
