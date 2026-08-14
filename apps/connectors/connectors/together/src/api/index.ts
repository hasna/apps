import type {
  TogetherConfig,
  ChatRequest,
  ChatResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ModelsResponse,
} from '../types';
import { TogetherClient } from './client';

export class Together {
  private readonly client: TogetherClient;

  constructor(config: TogetherConfig) {
    this.client = new TogetherClient(config);
  }

  static fromEnv(): Together {
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) {
      throw new Error('TOGETHER_API_KEY environment variable is required');
    }
    return new Together({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.client.post<ChatResponse>('/chat/completions', request);
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return this.client.post<EmbeddingResponse>('/embeddings', request);
  }

  async listModels(): Promise<ModelsResponse> {
    return this.client.get<ModelsResponse>('/models');
  }

  getClient(): TogetherClient {
    return this.client;
  }
}

export { TogetherClient } from './client';
