import type { DeepInfraConfig, ChatRequest, ChatResponse, ModelsResponse } from '../types';
import { DeepInfraClient } from './client';

export class DeepInfra {
  private readonly client: DeepInfraClient;

  constructor(config: DeepInfraConfig) {
    this.client = new DeepInfraClient(config);
  }

  async chat(params: ChatRequest): Promise<ChatResponse> {
    return this.client.chat(params);
  }

  async listModels(): Promise<ModelsResponse> {
    return this.client.listModels();
  }

  static fromEnv(): DeepInfra {
    const apiKey = process.env.DEEPINFRA_API_TOKEN;
    if (!apiKey) {
      throw new Error('DEEPINFRA_API_TOKEN environment variable is required');
    }
    return new DeepInfra({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { DeepInfraClient } from './client';
