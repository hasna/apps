import type { TesterArmyConfig, QueryParams, JsonBody } from '../types';
import { TesterArmyApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://tester.army';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: QueryParams;
  body?: JsonBody;
  headers?: Record<string, string>;
  auth?: boolean;
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export class TesterArmyClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: TesterArmyConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private buildUrl(path: string, params?: QueryParams): string {
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
    const { method = 'GET', params, body, headers = {}, auth = true } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...headers,
    };

    if (auth) {
      requestHeaders.Authorization = `Bearer ${this.apiKey}`;
    }

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
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
      data = text ? JSON.parse(text) : {};
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const message = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new TesterArmyApiError(message, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: JsonBody, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async patch<T>(path: string, body?: JsonBody, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, params });
  }

  async delete<T>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }
}
