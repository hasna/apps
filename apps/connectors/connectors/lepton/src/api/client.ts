import { LeptonApiError, type LeptonConfig, type ChatRequest, type ChatResponse, type ModelsResponse } from '../types';

const DEFAULT_BASE_URL = 'https://api.lepton.ai/v1';

export class LeptonClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: LeptonConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...options.headers,
      },
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      let errorMessage = String(data || response.statusText);
      if (typeof data === 'object' && data !== null) {
        const errorObj = data as { error?: { message?: string }; message?: string };
        errorMessage = errorObj.error?.message || errorObj.message || JSON.stringify(data);
      }
      throw new LeptonApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.request<ChatResponse>('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async listModels(): Promise<ModelsResponse> {
    return this.request<ModelsResponse>('/models');
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
