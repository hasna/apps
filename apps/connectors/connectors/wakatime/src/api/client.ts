import type { WakatimeConfig, QueryValue } from '../types';
import { WakatimeApiError } from '../types';

const DEFAULT_BASE_URL = 'https://wakatime.com/api/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, QueryValue>;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}

export class WakatimeClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: WakatimeConfig) {
    if (!config.apiKey) {
      throw new Error('WakaTime API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private authHeader(): string {
    if (this.apiKey.startsWith('waka_tok_')) {
      return `Bearer ${this.apiKey}`;
    }
    return `Basic ${Buffer.from(this.apiKey).toString('base64')}`;
  }

  private buildUrl(path: string, params?: Record<string, QueryValue>): string {
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
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: this.authHeader(),
      Accept: 'application/json',
      ...headers,
    };

    if (body && ['POST', 'PUT'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'DELETE'].includes(method)) {
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
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const errors = record.errors && typeof record.errors === 'object'
        ? JSON.stringify(record.errors)
        : undefined;
      const message = String(
        record.error ?? record.message ?? errors ?? response.statusText ?? `HTTP ${response.status}`,
      );
      throw new WakatimeApiError(message, response.status);
    }

    return data as T;
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

  async delete<T>(path: string, body?: Record<string, unknown>, params?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', body, params });
  }

  userPath(user?: string): string {
    return `/users/${encodeURIComponent(user ?? 'current')}`;
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
