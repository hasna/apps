import type { QueryValue, WhopConfig } from '../types';
import { parseWhopApiError, WhopApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.whop.com/api/v1';
export const DEFAULT_API_VERSION_DATE = '2026-06-20';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, QueryValue>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  retries?: number;
  timeout?: number;
}

export class WhopClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly apiVersionDate: string;

  constructor(config: WhopConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.apiVersionDate = config.apiVersionDate || DEFAULT_API_VERSION_DATE;
  }

  private buildUrl(path: string, params?: Record<string, QueryValue>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') {
          continue;
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number, baseDelay = 1000): number {
    return baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, retries = 3, timeout = 30000 } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'Api-Version-Date': this.apiVersionDate,
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

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

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
          if (this.isRetryableStatus(response.status) && attempt < retries) {
            const retryAfter = response.headers.get('retry-after');
            const delay = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : this.getRetryDelay(attempt);
            await this.sleep(delay);
            continue;
          }

          throw parseWhopApiError(data, response.status);
        }

        return data as T;
      } catch (err) {
        if (err instanceof WhopApiError) {
          throw err;
        }

        const lastError = err instanceof Error ? err : new Error(String(err));
        if (lastError.name === 'AbortError') {
          if (attempt < retries) {
            await this.sleep(this.getRetryDelay(attempt));
            continue;
          }
          throw new Error(`Request timeout after ${timeout}ms`);
        }

        if (attempt < retries) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw lastError;
      }
    }

    throw new Error('Request failed after retries');
  }

  async get<T>(path: string, params?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string,
    params?: Record<string, QueryValue>
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async patch<T>(
    path: string,
    body?: Record<string, unknown> | object,
    params?: Record<string, QueryValue>
  ): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
