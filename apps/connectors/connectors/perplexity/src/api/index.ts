import type { PerplexityConfig } from '../types';
import { PerplexityClient } from './client';
import { ChatApi } from './example';

/**
 * Perplexity AI API Client
 */
export class Perplexity {
  private readonly client: PerplexityClient;

  // API modules
  public readonly chat: ChatApi;

  constructor(config: PerplexityConfig) {
    this.client = new PerplexityClient(config);
    this.chat = new ChatApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for PERPLEXITY_API_KEY
   */
  static fromEnv(): Perplexity {
    const apiKey = process.env.PERPLEXITY_API_KEY;

    if (!apiKey) {
      throw new Error('PERPLEXITY_API_KEY environment variable is required');
    }
    return new Perplexity({ apiKey });
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
  getClient(): PerplexityClient {
    return this.client;
  }
}

export { PerplexityClient } from './client';
export { ChatApi } from './example';
