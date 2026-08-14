import type { QueryValue, TypeformConfig } from '../types';
import { TypeformApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.typeform.com';

export interface TypeformRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, QueryValue>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function appendQuery(path: string, params?: Record<string, QueryValue>): string {
  if (!params) return path;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      search.set(key, value.map(String).join(','));
    } else {
      search.set(key, String(value));
    }
  }

  return search.size > 0 ? `${path}?${search}` : path;
}

export class TypeformClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(config: TypeformConfig) {
    if (!config.apiToken) {
      throw new Error('Typeform API token is required');
    }
    this.apiToken = config.apiToken;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  getApiTokenPreview(): string {
    if (this.apiToken.length > 10) {
      return `${this.apiToken.substring(0, 6)}...${this.apiToken.substring(this.apiToken.length - 4)}`;
    }
    return '***';
  }

  async request<T>(path: string, options: TypeformRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = `${this.baseUrl}${appendQuery(path, params)}`;

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
      Accept: 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = { method, headers: requestHeaders };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
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
        data = text;
      }
    }

    if (!response.ok) {
      const errData = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
      const message = (errData.description as string) || (errData.message as string) || response.statusText;
      throw new TypeformApiError(message, response.status, errData.code as string | undefined);
    }

    return (data ?? {}) as T;
  }

  async get<T>(path: string, params?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown>, params?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async put<T>(path: string, body?: Record<string, unknown>, params?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown>, params?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, params });
  }

  async delete<T>(path: string, params?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }
}
