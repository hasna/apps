import type { GroqConfig, ChatRequest, ChatResponse, ModelsResponse } from '../types';
import { GroqClient } from './client';

export class Groq {
  private readonly client: GroqClient;

  constructor(config: GroqConfig) {
    this.client = new GroqClient(config);
  }

  static fromEnv(): Groq {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY environment variable is required');
    }
    return new Groq({ apiKey });
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

  getClient(): GroqClient {
    return this.client;
  }
}

export { GroqClient } from './client';
