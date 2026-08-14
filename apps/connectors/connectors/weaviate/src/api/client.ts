import type { WeaviateConfig } from '../types';
import { WeaviateApiError } from '../types';

export class WeaviateClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(config: WeaviateConfig) {
    if (!config.host) throw new Error('Weaviate host is required');
    this.baseUrl = `${config.host.replace(/\/$/, '')}/v1`;
    this.apiKey = config.apiKey;
  }

  async request<T>(
    path: string,
    options: { method?: string; body?: Record<string, unknown> } = {},
  ): Promise<T> {
    const { method = 'GET', body } = options;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${path}`, fetchOptions);
    if (response.status === 204) return {} as T;

    const text = await response.text();
    let data: Record<string, unknown> = {};
    if (text) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        data = {};
      }
    }

    if (!response.ok) {
      const message =
        (data as { error?: Array<{ message?: string }> })?.error?.[0]?.message ||
        (data as { message?: string })?.message ||
        text.slice(0, 200) ||
        response.statusText;
      throw new WeaviateApiError(`Weaviate: ${response.status} ${message}`, response.status);
    }

    return data as T;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
