import type { MistralConfig, ModelsResponse } from '../types';
import { MistralClient } from './client';
import { ChatApi } from './chat';
import { EmbeddingsApi } from './embeddings';

/**
 * Mistral AI API Client
 */
export class Mistral {
  private readonly client: MistralClient;

  // API modules
  public readonly chat: ChatApi;
  public readonly embeddings: EmbeddingsApi;

  constructor(config: MistralConfig) {
    this.client = new MistralClient(config);
    this.chat = new ChatApi(this.client);
    this.embeddings = new EmbeddingsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for MISTRAL_API_KEY
   */
  static fromEnv(): Mistral {
    const apiKey = process.env.MISTRAL_API_KEY;

    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY environment variable is required');
    }
    return new Mistral({ apiKey });
  }

  /**
   * List available models
   */
  async listModels(): Promise<ModelsResponse> {
    return this.client.get<ModelsResponse>('/models');
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
  getClient(): MistralClient {
    return this.client;
  }
}

// Alias for backward compatibility
export const Connector = Mistral;

export { MistralClient } from './client';
export { ChatApi } from './chat';
export { EmbeddingsApi } from './embeddings';
