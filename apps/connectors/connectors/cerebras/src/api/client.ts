import { CerebrasApiError, type CerebrasConfig, type ChatRequest, type ChatResponse, type ModelsResponse } from '../types';

const DEFAULT_BASE_URL = 'https://api.cerebras.ai/v1';

export class CerebrasClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: CerebrasConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let message = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        message = errorJson.error?.message || errorJson.message || errorText;
      } catch {
        // Use raw text
      }
      throw new CerebrasApiError(message, response.status);
    }

    return response.json() as Promise<T>;
  }

  async chat(params: ChatRequest): Promise<ChatResponse> {
    return this.request<ChatResponse>('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(params),
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
