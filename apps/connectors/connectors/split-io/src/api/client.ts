import type { OutputFormat } from '../types';
import { SplitIoApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.split.io/internal/api/v2';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined | string[]>;
  body?: Record<string, unknown> | unknown[] | string | URLSearchParams;
  headers?: Record<string, string>;
  format?: OutputFormat;
  jsonPatch?: boolean;
}

export class SplitIoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string = DEFAULT_BASE_URL) {
    if (!apiKey?.trim()) {
      throw new Error('API key is required');
    }
    this.apiKey = apiKey.trim();
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined | string[]>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, jsonPatch = false } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (body instanceof URLSearchParams) {
        requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      } else {
        requestHeaders['Content-Type'] = jsonPatch ? 'application/json-patch+json' : 'application/json';
      }
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = body instanceof URLSearchParams
        ? body
        : typeof body === 'string'
          ? body
          : JSON.stringify(body);
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
      const text = await response.text();
      data = text ? text : {};
    }

    if (!response.ok) {
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const message = String(record.message ?? record.error ?? response.statusText);
      throw new SplitIoApiError(message, response.status, data);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined | string[]>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | URLSearchParams,
    params?: Record<string, string | number | boolean | undefined | string[]>,
    jsonPatch?: boolean,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params, jsonPatch });
  }

  async put<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | URLSearchParams,
    params?: Record<string, string | number | boolean | undefined | string[]>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async patch<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | URLSearchParams,
    params?: Record<string, string | number | boolean | undefined | string[]>,
    jsonPatch?: boolean,
  ): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, params, jsonPatch });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined | string[]>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
