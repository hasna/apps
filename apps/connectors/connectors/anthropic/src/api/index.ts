import type { AnthropicConfig } from '../types';
import { AnthropicClient } from './client';
import { MessagesApi } from './messages';

/**
 * Anthropic API Client
 */
export class Anthropic {
  private readonly client: AnthropicClient;

  // API modules
  public readonly messages: MessagesApi;

  constructor(config: AnthropicConfig) {
    this.client = new AnthropicClient(config);
    this.messages = new MessagesApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for ANTHROPIC_API_KEY
   */
  static fromEnv(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    return new Anthropic({ apiKey });
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
  getClient(): AnthropicClient {
    return this.client;
  }
}

// Alias for backward compatibility
export const Connector = Anthropic;

export { AnthropicClient } from './client';
export { MessagesApi } from './messages';
