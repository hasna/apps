import { BasetenApiError, type BasetenConfig, type ModelsResponse, type PredictionRequest, type PredictionResponse } from '../types';

const DEFAULT_BASE_URL = 'https://api.baseten.co/v1';

export class BasetenClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: BasetenConfig) {
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
        'Authorization': `Api-Key ${this.apiKey}`,
        ...options.headers,
      },
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      let errorMessage = String(data || response.statusText);
      if (typeof data === 'object' && data !== null) {
        const errorObj = data as { error?: { message?: string }; message?: string; detail?: string };
        errorMessage = errorObj.error?.message || errorObj.message || errorObj.detail || JSON.stringify(data);
      }
      throw new BasetenApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async listModels(): Promise<ModelsResponse> {
    return this.request<ModelsResponse>('/models');
  }

  async getModel(modelId: string): Promise<{ model: unknown }> {
    return this.request<{ model: unknown }>(`/models/${modelId}`);
  }

  async predict(request: PredictionRequest): Promise<PredictionResponse> {
    const { model_id, version_id, input } = request;
    const endpoint = version_id
      ? `/models/${model_id}/versions/${version_id}/predict`
      : `/models/${model_id}/predict`;
    return this.request<PredictionResponse>(endpoint, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
