import type { OpenAIConfig, ModelsResponse } from '../types';
import { OpenAIClient } from './client';
import { ChatApi } from './chat';
import { EmbeddingsApi } from './embeddings';
import { ImagesApi } from './images';

/**
 * OpenAI API Client
 */
export class OpenAI {
  private readonly client: OpenAIClient;

  // API modules
  public readonly chat: ChatApi;
  public readonly embeddings: EmbeddingsApi;
  public readonly images: ImagesApi;

  constructor(config: OpenAIConfig) {
    this.client = new OpenAIClient(config);
    this.chat = new ChatApi(this.client);
    this.embeddings = new EmbeddingsApi(this.client);
    this.images = new ImagesApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for OPENAI_API_KEY
   */
  static fromEnv(): OpenAI {
    const apiKey = process.env.OPENAI_API_KEY;
    const organization = process.env.OPENAI_ORGANIZATION;

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    return new OpenAI({ apiKey, organization });
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
  getClient(): OpenAIClient {
    return this.client;
  }
}

// Alias for backward compatibility
export const Connector = OpenAI;

export { OpenAIClient } from './client';
export { ChatApi } from './chat';
export { EmbeddingsApi } from './embeddings';
export { ImagesApi } from './images';
