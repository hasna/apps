import type { ConnectorConfig } from '../types';
import { ConnectorApiError, parseApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.split-in-batches.com/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  timeout?: number;
}

export class ConnectorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ConnectorConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): string {
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

  encodePathSegment(segment: string): string {
    return encodeURIComponent(segment);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      params,
      body,
      headers = {},
      timeout = 30000,
    } = options;

    const url = this.buildUrl(path, params);
    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 204) {
        return {} as T;
      }

      const contentType = response.headers.get('content-type') || '';
      let data: unknown;

      if (contentType.includes('application/json')) {
        const text = await response.text();
        data = text ? JSON.parse(text) : undefined;
      } else {
        data = await response.text();
      }

      if (!response.ok) {
        throw parseApiError(data, response.status);
      }

      return data as T;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof ConnectorApiError) {
        throw err;
      }

      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }

      throw err;
    }
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[],
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
