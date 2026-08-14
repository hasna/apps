import { LumaApiError, type LumaConfig, type GenerationRequest, type ImageToVideoRequest, type Generation, type GenerationsListResponse } from '../types';

const DEFAULT_BASE_URL = 'https://api.lumalabs.ai/dream-machine/v1';

export class LumaClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: LumaConfig) {
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
        message = errorJson.detail || errorJson.error || errorJson.message || errorText;
      } catch {
        // Use raw text
      }
      throw new LumaApiError(message, response.status);
    }

    return response.json() as Promise<T>;
  }

  async createGeneration(params: GenerationRequest): Promise<Generation> {
    return this.request<Generation>('/generations', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async imageToVideo(params: ImageToVideoRequest): Promise<Generation> {
    return this.request<Generation>('/generations', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getGeneration(generationId: string): Promise<Generation> {
    return this.request<Generation>(`/generations/${generationId}`);
  }

  async listGenerations(limit?: number, offset?: number): Promise<GenerationsListResponse> {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    if (offset) params.append('offset', String(offset));
    const query = params.toString();
    return this.request<GenerationsListResponse>(`/generations${query ? '?' + query : ''}`);
  }

  async deleteGeneration(generationId: string): Promise<void> {
    await this.request<void>(`/generations/${generationId}`, {
      method: 'DELETE',
    });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
