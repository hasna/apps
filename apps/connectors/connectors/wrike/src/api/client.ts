import type { WrikeConfig } from '../types';
import { parseWrikeError } from '../types';

const DEFAULT_HOST = 'www.wrike.com';

export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, QueryValue | string[]>;
  body?: Record<string, unknown> | unknown[];
}

export class WrikeClient {
  private readonly apiToken: string;
  private readonly host: string;

  constructor(config: WrikeConfig) {
    if (!config.apiToken?.trim()) {
      throw new Error('API token is required');
    }
    this.apiToken = config.apiToken.trim();
    this.host = (config.host?.trim() || DEFAULT_HOST).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }

  getBaseUrl(): string {
    return `https://${this.host}/api/v4`;
  }

  buildQuery(params?: Record<string, QueryValue | string[]>): string {
    if (!params) return '';

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      if (Array.isArray(value)) {
        query.set(key, JSON.stringify(value));
      } else {
        query.set(key, String(value));
      }
    }

    const text = query.toString();
    return text ? `?${text}` : '';
  }

  private buildUrl(path: string, params?: Record<string, QueryValue | string[]>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.getBaseUrl()}${normalizedPath}${this.buildQuery(params)}`;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body } = options;
    const url = this.buildUrl(path, params);

    const headers: Record<string, string> = {
      Authorization: `bearer ${this.apiToken}`,
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = { method, headers };

    if (body && ['POST', 'PUT'].includes(method)) {
      headers['Content-Type'] = 'application/json';
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
      throw parseWrikeError(data, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, QueryValue | string[]>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[],
    params?: Record<string, QueryValue | string[]>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async put<T>(
    path: string,
    body?: Record<string, unknown> | unknown[],
    params?: Record<string, QueryValue | string[]>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async delete<T>(path: string, params?: Record<string, QueryValue | string[]>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getTokenPreview(): string {
    if (this.apiToken.length > 10) {
      return `${this.apiToken.substring(0, 6)}...${this.apiToken.substring(this.apiToken.length - 4)}`;
    }
    return '***';
  }

  getHost(): string {
    return this.host;
  }
}
