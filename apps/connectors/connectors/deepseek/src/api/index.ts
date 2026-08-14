import type { DeepSeekConfig, ChatRequest, ChatResponse, ModelsResponse } from '../types';
import { DeepSeekClient } from './client';

export class DeepSeek {
  private readonly client: DeepSeekClient;

  constructor(config: DeepSeekConfig) {
    this.client = new DeepSeekClient(config);
  }

  static fromEnv(): DeepSeek {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY environment variable is required');
    }
    return new DeepSeek({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.client.post<ChatResponse>('/chat/completions', request);
  }

  async listModels(): Promise<ModelsResponse> {
    return this.client.get<ModelsResponse>('/models');
  }

  getClient(): DeepSeekClient {
    return this.client;
  }
}

export { DeepSeekClient } from './client';
