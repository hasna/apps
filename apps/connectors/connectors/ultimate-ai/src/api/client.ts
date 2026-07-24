import type { UltimateAiConfig } from '../types';
import { UltimateAiApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.ultimate.ai/v1';

export class UltimateAiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: UltimateAiConfig) {
    if (!config.apiKey) {
      throw new Error('Ultimate AI API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
    } = {},
  ): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = { method, headers };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        (data as { message?: string })?.message ||
        (data as { error?: string })?.error ||
        response.statusText;
      throw new UltimateAiApiError(message, response.status);
    }

    return data as T;
  }
}
