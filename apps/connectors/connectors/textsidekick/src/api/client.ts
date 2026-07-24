import type { TextsidekickConfig } from '../types';
import { TextsidekickApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.textsidekick.com/v1';

export class TextsidekickClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: TextsidekickConfig) {
    if (!config.apiKey) throw new Error('Textsidekick apiKey is required');
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? process.env.TEXTSIDEKICK_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | undefined>;
    } = {},
  ): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) url.searchParams.append(k, String(v));
      });
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = JSON.stringify(body);
    }
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new TextsidekickApiError(
        (data as { message?: string; error?: string })?.message ||
          (data as { error?: string })?.error ||
          response.statusText,
        response.status,
      );
    }
    return data as T;
  }
}
