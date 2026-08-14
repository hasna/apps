import { PikaApiError, type PikaConfig, type GenerateVideoRequest, type ImageToVideoRequest, type VideoGeneration, type GenerateResponse } from '../types';

const DEFAULT_BASE_URL = 'https://api.pika.art/v1';

export class PikaClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: PikaConfig) {
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
        message = errorJson.error || errorJson.message || errorText;
      } catch {
        // Use raw text
      }
      throw new PikaApiError(message, response.status);
    }

    return response.json() as Promise<T>;
  }

  async generateVideo(params: GenerateVideoRequest): Promise<GenerateResponse> {
    return this.request<GenerateResponse>('/generate', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async imageToVideo(params: ImageToVideoRequest): Promise<GenerateResponse> {
    return this.request<GenerateResponse>('/animate', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getGeneration(generationId: string): Promise<VideoGeneration> {
    return this.request<VideoGeneration>(`/generations/${generationId}`);
  }

  async cancelGeneration(generationId: string): Promise<void> {
    await this.request<void>(`/generations/${generationId}/cancel`, {
      method: 'POST',
    });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
