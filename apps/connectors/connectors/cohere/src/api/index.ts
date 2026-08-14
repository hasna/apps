import type {
  CohereConfig,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  RerankRequest,
  RerankResponse,
  ClassifyRequest,
  ClassifyResponse,
  ModelsResponse,
} from '../types';
import { CohereClient } from './client';

export class Cohere {
  private readonly client: CohereClient;

  constructor(config: CohereConfig) {
    this.client = new CohereClient(config);
  }

  static fromEnv(): Cohere {
    const apiKey = process.env.COHERE_API_KEY;
    if (!apiKey) {
      throw new Error('COHERE_API_KEY environment variable is required');
    }
    return new Cohere({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.client.post<ChatResponse>('/chat', request);
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    return this.client.post<EmbedResponse>('/embed', request);
  }

  async rerank(request: RerankRequest): Promise<RerankResponse> {
    return this.client.post<RerankResponse>('/rerank', request);
  }

  async classify(request: ClassifyRequest): Promise<ClassifyResponse> {
    return this.client.post<ClassifyResponse>('/classify', request);
  }

  async listModels(): Promise<ModelsResponse> {
    return this.client.get<ModelsResponse>('/models');
  }

  getClient(): CohereClient {
    return this.client;
  }
}

export { CohereClient } from './client';
