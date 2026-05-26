import { RunwayApiError, type RunwayConfig, type ImageToVideoRequest, type TextToVideoRequest, type VideoTask, type TaskResponse } from '../types';

const DEFAULT_BASE_URL = 'https://api.runwayml.com/v1';

export class RunwayClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: RunwayConfig) {
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
      'X-Runway-Version': '2024-11-06',
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
      throw new RunwayApiError(message, response.status);
    }

    return response.json() as Promise<T>;
  }

  async imageToVideo(params: ImageToVideoRequest): Promise<TaskResponse> {
    return this.request<TaskResponse>('/image_to_video', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async textToVideo(params: TextToVideoRequest): Promise<TaskResponse> {
    return this.request<TaskResponse>('/text_to_video', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getTask(taskId: string): Promise<VideoTask> {
    return this.request<VideoTask>(`/tasks/${taskId}`);
  }

  async cancelTask(taskId: string): Promise<void> {
    await this.request<void>(`/tasks/${taskId}/cancel`, {
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
