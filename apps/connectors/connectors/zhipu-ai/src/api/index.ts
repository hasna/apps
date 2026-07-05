import type {
  ZhipuAiConfig,
  ChatRequest,
  ChatResponse,
  ModelsResponse,
  ZhipuAiModel,
  SearchRequest,
  SearchResponse,
} from '../types';
import { ZhipuAiClient } from './client';

export class ZhipuAi {
  private readonly client: ZhipuAiClient;

  constructor(config: ZhipuAiConfig) {
    this.client = new ZhipuAiClient(config);
  }

  static fromEnv(): ZhipuAi {
    const apiKey = process.env.ZHIPU_AI_API_KEY;
    if (!apiKey) {
      throw new Error('ZHIPU_AI_API_KEY environment variable is required');
    }
    const baseUrl = process.env.ZHIPU_AI_BASE_URL;
    return new ZhipuAi({ apiKey, baseUrl });
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

  async getModel(modelId: string): Promise<ZhipuAiModel> {
    return this.client.get<ZhipuAiModel>(`/models/${encodeURIComponent(modelId)}`);
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    return this.client.post<SearchResponse>('/web_search', request);
  }

  getClient(): ZhipuAiClient {
    return this.client;
  }
}

export { ZhipuAiClient } from './client';
