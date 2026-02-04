import type { HuggingFaceConfig } from '../types';
import { HuggingFaceClient } from './client';
import { ExampleApi } from './example';

/**
 * Main HuggingFace API class
 */
export class HuggingFace {
  private readonly client: HuggingFaceClient;

  // API modules - add more as needed
  public readonly example: ExampleApi;

  constructor(config: HuggingFaceConfig) {
    this.client = new HuggingFaceClient(config);
    this.example = new ExampleApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for HUGGINGFACE_API_KEY or HF_TOKEN
   */
  static fromEnv(): HuggingFace {
    const apiKey = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;
    const apiSecret = process.env.HUGGINGFACE_API_SECRET;

    if (!apiKey) {
      throw new Error('HUGGINGFACE_API_KEY or HF_TOKEN environment variable is required');
    }
    return new HuggingFace({ apiKey, apiSecret });
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
  getClient(): HuggingFaceClient {
    return this.client;
  }
}

export { HuggingFaceClient } from './client';
export { ExampleApi } from './example';
