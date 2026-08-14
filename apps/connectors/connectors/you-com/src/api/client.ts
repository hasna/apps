import type { YouComConfig } from '../types';
import { YouComApiError } from '../types';

export const DEFAULT_SEARCH_BASE_URL = 'https://ydc-index.io';
export const DEFAULT_RESEARCH_BASE_URL = 'https://api.you.com';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string | object;
  headers?: Record<string, string>;
  baseUrl?: string;
}

export class YouComClient {
  private readonly apiKey: string;
  private readonly searchBaseUrl: string;
  private readonly researchBaseUrl: string;

  constructor(config: YouComConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.searchBaseUrl = (config.searchBaseUrl || DEFAULT_SEARCH_BASE_URL).replace(/\/$/, '');
    this.researchBaseUrl = (config.researchBaseUrl || DEFAULT_RESEARCH_BASE_URL).replace(/\/$/, '');
  }

  getSearchBaseUrl(): string {
    return this.searchBaseUrl;
  }

  getResearchBaseUrl(): string {
    return this.researchBaseUrl;
  }

  private buildUrl(
    baseUrl: string,
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): string {
    const url = new URL(`${baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, baseUrl = this.searchBaseUrl } = options;
    const url = this.buildUrl(baseUrl, path, params);

    const requestHeaders: Record<string, string> = {
      'X-API-Key': this.apiKey,
      Accept: 'application/json',
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    let data: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const errorMessage =
        typeof data === 'object' && data !== null
          ? JSON.stringify(data)
          : String(data || response.statusText);
      throw new YouComApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    baseUrl?: string,
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, baseUrl });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | object,
    baseUrl?: string,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, baseUrl });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
