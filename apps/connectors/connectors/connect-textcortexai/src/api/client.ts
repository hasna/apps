import type { TextCortexConfig } from '../types';
import { TextCortexApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.textcortex.com/v1';

export class TextCortexClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: TextCortexConfig) {
    if (!config.apiKey) throw new Error('TextCortex API key is required');
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = (data as { message?: string })?.message || response.statusText;
      throw new TextCortexApiError(msg, response.status);
    }
    return data as T;
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = (data as { message?: string })?.message || response.statusText;
      throw new TextCortexApiError(msg, response.status);
    }
    return data as T;
  }

  getApiKeyPreview(): string {
    return `${this.apiKey.substring(0, 8)}...`;
  }
}
