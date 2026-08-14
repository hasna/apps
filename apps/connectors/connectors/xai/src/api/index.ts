import type { XAIConfig, ModelsResponse } from '../types';
import { XAIClient } from './client';
import { ChatApi } from './chat';

/**
 * xAI Grok API Client
 */
export class XAI {
  private readonly client: XAIClient;

  // API modules
  public readonly chat: ChatApi;

  constructor(config: XAIConfig) {
    this.client = new XAIClient(config);
    this.chat = new ChatApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for XAI_API_KEY
   */
  static fromEnv(): XAI {
    const apiKey = process.env.XAI_API_KEY;

    if (!apiKey) {
      throw new Error('XAI_API_KEY environment variable is required');
    }
    return new XAI({ apiKey });
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
  getClient(): XAIClient {
    return this.client;
  }
}

// Alias for backward compatibility
export const Connector = XAI;

export { XAIClient } from './client';
export { ChatApi } from './chat';
