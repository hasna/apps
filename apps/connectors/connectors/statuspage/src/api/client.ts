import type { StatuspageConfig } from '../types';
import { StatuspageApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.statuspage.io/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
}

export class StatuspageClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: StatuspageConfig) {
    if (!config.apiKey) {
      throw new Error('Statuspage API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = DEFAULT_BASE_URL;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
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
      Authorization: `OAuth ${this.apiKey}`,
      Accept: 'application/json',
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type') || '';
    let data: unknown = null;

    if (contentType.includes('application/json')) {
      const text = await response.text();
      data = text ? JSON.parse(text) : null;
    } else {
      const text = await response.text();
      data = text || null;
    }

    if (!response.ok) {
      const message =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error?: string }).error)
          : typeof data === 'object' && data !== null && 'message' in data
            ? String((data as { message?: string }).message)
            : response.statusText || 'Request failed';
      throw new StatuspageApiError(message, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, params });
  }

  async put<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }
}
