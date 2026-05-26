import type { FireworksConfig, ChatRequest, ChatResponse, ModelsResponse } from '../types';
import { FireworksClient } from './client';

export class Fireworks {
  private readonly client: FireworksClient;

  constructor(config: FireworksConfig) {
    this.client = new FireworksClient(config);
  }

  static fromEnv(): Fireworks {
    const apiKey = process.env.FIREWORKS_API_KEY;
    if (!apiKey) {
      throw new Error('FIREWORKS_API_KEY environment variable is required');
    }
    return new Fireworks({ apiKey });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.client.chat(request);
  }

  async listModels(): Promise<ModelsResponse> {
    return this.client.listModels();
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): FireworksClient {
    return this.client;
  }
}

export { FireworksClient } from './client';
