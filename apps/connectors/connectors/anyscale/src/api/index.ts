import type { AnyscaleConfig, ChatRequest, ChatResponse, ModelsResponse } from '../types';
import { AnyscaleClient } from './client';

export class Anyscale {
  private readonly client: AnyscaleClient;

  constructor(config: AnyscaleConfig) {
    this.client = new AnyscaleClient(config);
  }

  static fromEnv(): Anyscale {
    const apiKey = process.env.ANYSCALE_API_KEY;
    if (!apiKey) {
      throw new Error('ANYSCALE_API_KEY environment variable is required');
    }
    return new Anyscale({ apiKey });
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

  getClient(): AnyscaleClient {
    return this.client;
  }
}

export { AnyscaleClient } from './client';
