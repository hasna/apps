import type { CerebrasConfig, ChatRequest, ChatResponse, ModelsResponse } from '../types';
import { CerebrasClient } from './client';

export class Cerebras {
  private readonly client: CerebrasClient;

  constructor(config: CerebrasConfig) {
    this.client = new CerebrasClient(config);
  }

  async chat(params: ChatRequest): Promise<ChatResponse> {
    return this.client.chat(params);
  }

  async listModels(): Promise<ModelsResponse> {
    return this.client.listModels();
  }

  static fromEnv(): Cerebras {
    const apiKey = process.env.CEREBRAS_API_KEY;
    if (!apiKey) {
      throw new Error('CEREBRAS_API_KEY environment variable is required');
    }
    return new Cerebras({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { CerebrasClient } from './client';
