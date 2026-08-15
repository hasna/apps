import type {
  AnthropicMessageRequest,
  ChatRequest,
  ChatResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  GatewayModel,
  ModelsResponse,
  RawRequestOptions,
  ResponseRequest,
  VercelAiGatewayConfig,
} from '../types';
import {
  ANTHROPIC_BASE_URL,
  OPENAI_BASE_URL,
  OPENRESPONSES_BASE_URL,
  resolveBaseUrl,
  VercelAiGatewayClient,
} from './client';

export class VercelAiGateway {
  private readonly client: VercelAiGatewayClient;

  constructor(config: VercelAiGatewayConfig) {
    this.client = new VercelAiGatewayClient(config);
  }

  static fromEnv(): VercelAiGateway {
    const apiKey = process.env.VERCEL_AI_GATEWAY_API_KEY;
    if (!apiKey) {
      throw new Error('VERCEL_AI_GATEWAY_API_KEY environment variable is required');
    }
    return new VercelAiGateway({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  async listModels(): Promise<ModelsResponse> {
    return this.client.get<ModelsResponse>('/models', undefined, OPENAI_BASE_URL);
  }

  async getModel(model: string): Promise<GatewayModel> {
    return this.client.get<GatewayModel>(
      `/models/${encodeURIComponent(model)}`,
      undefined,
      OPENAI_BASE_URL,
    );
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.client.post<ChatResponse>('/chat/completions', request, {
      baseUrl: OPENAI_BASE_URL,
    });
  }

  async streamChat(request: ChatRequest): Promise<ChatResponse> {
    return this.chat({ ...request, stream: true });
  }

  async createEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return this.client.post<EmbeddingResponse>('/embeddings', request, {
      baseUrl: OPENAI_BASE_URL,
    });
  }

  async createResponse(request: ResponseRequest): Promise<unknown> {
    return this.client.post('/responses', request, { baseUrl: OPENAI_BASE_URL });
  }

  async streamResponse(request: ResponseRequest): Promise<unknown> {
    return this.createResponse({ ...request, stream: true });
  }

  async createOpenResponse(request: ResponseRequest): Promise<unknown> {
    return this.client.post('/responses', request, { baseUrl: OPENRESPONSES_BASE_URL });
  }

  async createAnthropicMessage(request: AnthropicMessageRequest): Promise<unknown> {
    const { anthropic_version, ...body } = request;
    return this.client.post('/v1/messages', body, {
      baseUrl: ANTHROPIC_BASE_URL,
      headers: {
        'anthropic-version': anthropic_version || '2023-06-01',
        'x-api-key': this.client.getApiKey(),
      },
    });
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    const baseUrl = options.compatibility
      ? resolveBaseUrl(options.compatibility)
      : OPENAI_BASE_URL;
    const method = options.method ?? (options.body ? 'POST' : 'GET');
    return this.client.request(options.path, {
      method,
      body: options.body,
      params: options.query,
      baseUrl,
      headers: options.headers,
    });
  }

  getClient(): VercelAiGatewayClient {
    return this.client;
  }
}

export { VercelAiGatewayClient, resolveBaseUrl, OPENAI_BASE_URL, ANTHROPIC_BASE_URL, OPENRESPONSES_BASE_URL } from './client';
