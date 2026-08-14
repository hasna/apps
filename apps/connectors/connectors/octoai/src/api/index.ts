import type { OctoAIConfig, ChatRequest, ChatResponse, ModelsResponse } from '../types';
import { OctoAIClient } from './client';

export class OctoAI {
  private readonly client: OctoAIClient;

  constructor(config: OctoAIConfig) {
    this.client = new OctoAIClient(config);
  }

  static fromEnv(): OctoAI {
    const apiKey = process.env.OCTOAI_TOKEN;
    if (!apiKey) {
      throw new Error('OCTOAI_TOKEN environment variable is required');
    }
    return new OctoAI({ apiKey });
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

  getClient(): OctoAIClient {
    return this.client;
  }
}

export { OctoAIClient } from './client';
