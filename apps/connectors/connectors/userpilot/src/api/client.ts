import type { UserpilotConfig, UserpilotErrorResponse } from '../types';
import { UserpilotApiError, USERPILOT_API_VERSION, USERPILOT_BASE_URL } from '../types';

export type QueryParams = object;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: QueryParams;
  body?: object | unknown[];
}

export class UserpilotClient {
  private readonly apiKey: string;

  constructor(config: UserpilotConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
  }

  getBaseUrl(): string {
    return USERPILOT_BASE_URL;
  }

  getApiVersion(): string {
    return USERPILOT_API_VERSION;
  }

  private buildUrl(path: string, params?: QueryParams): string {
    const url = new URL(`${USERPILOT_BASE_URL}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body } = options;
    const url = this.buildUrl(path, params);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'X-API-Version': USERPILOT_API_VERSION,
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = { method, headers };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    let data: unknown;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    } else {
      data = {};
    }

    if (!response.ok) {
      const errorData = data as UserpilotErrorResponse;
      const message = errorData.message || errorData.error || `Request failed (${response.status})`;
      throw new UserpilotApiError(message, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: object | unknown[]): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
