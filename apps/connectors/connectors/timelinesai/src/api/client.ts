import type { ErrorResponse } from '../types';
import { TimelinesAIApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://app.timelines.ai/integrations/api';

export interface TimelinesAIClientConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}

export class TimelinesAIClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: TimelinesAIClientConfig) {
    if (!config.apiKey) {
      throw new Error('TimelinesAI API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  encodePathSegment(value: string | number): string {
    return encodeURIComponent(String(value));
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

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
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = { method, headers: requestHeaders };

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    let data: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const text = await response.text();
      data = text ? JSON.parse(text) : undefined;
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const errorData = data as ErrorResponse | undefined;
      const message =
        errorData?.message ||
        errorData?.error ||
        (typeof data === 'string' ? data : response.statusText);
      throw new TimelinesAIApiError(message, response.status, data);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  async patch<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
