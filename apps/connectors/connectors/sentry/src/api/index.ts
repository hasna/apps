import type { SentryConfig } from '../types';
import { SentryClient } from './client';
import { ExampleApi } from './example';

/**
 * Main Sentry connector class
 */
export class Sentry {
  private readonly client: SentryClient;

  // API modules - add more as needed
  public readonly example: ExampleApi;

  constructor(config: SentryConfig) {
    this.client = new SentryClient(config);
    this.example = new ExampleApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for SENTRY_AUTH_TOKEN or SENTRY_API_KEY
   */
  static fromEnv(): Sentry {
    const apiKey = process.env.SENTRY_AUTH_TOKEN || process.env.SENTRY_API_KEY;
    const baseUrl = process.env.SENTRY_BASE_URL;

    if (!apiKey) {
      throw new Error('SENTRY_AUTH_TOKEN or SENTRY_API_KEY environment variable is required');
    }
    return new Sentry({ apiKey, baseUrl });
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
  getClient(): SentryClient {
    return this.client;
  }
}

export { SentryClient } from './client';
export { ExampleApi } from './example';
