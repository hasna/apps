import type { LeptonConfig, ChatRequest, ChatResponse, ModelsResponse } from '../types';
import { LeptonClient } from './client';

export class Lepton {
  private readonly client: LeptonClient;

  constructor(config: LeptonConfig) {
    this.client = new LeptonClient(config);
  }

  static fromEnv(): Lepton {
    const apiKey = process.env.LEPTON_API_TOKEN;
    if (!apiKey) {
      throw new Error('LEPTON_API_TOKEN environment variable is required');
    }
    return new Lepton({ apiKey });
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

  getClient(): LeptonClient {
    return this.client;
  }
}

export { LeptonClient } from './client';
