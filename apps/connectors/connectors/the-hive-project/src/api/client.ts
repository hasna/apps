import type { TheHiveProjectConfig, ListQueryParams } from '../types';
import { TheHiveProjectApiError, parseApiError } from '../types';

export const API_PATH_PREFIX = '/api/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: ListQueryParams;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  retries?: number;
  timeout?: number;
}

export class TheHiveProjectClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly organisation?: string;

  constructor(config: TheHiveProjectConfig) {
    const key = config.apiKey || config.token;
    if (!key) {
      throw new Error('API key (Bearer token) is required');
    }
    if (!config.baseUrl) {
      throw new Error('TheHive instance base URL is required');
    }
    this.apiKey = key;
    this.baseUrl = normalizeInstanceBaseUrl(config.baseUrl);
    this.organisation = config.organisation;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private buildUrl(path: string, params?: ListQueryParams): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const apiPath =
      normalizedPath === API_PATH_PREFIX || normalizedPath.startsWith(`${API_PATH_PREFIX}/`)
        ? normalizedPath
        : `${API_PATH_PREFIX}${normalizedPath}`;
    const url = new URL(`${this.baseUrl}${apiPath}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
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
      ...headers,
    };

    if (this.organisation && !('X-Organisation' in requestHeaders)) {
      requestHeaders['X-Organisation'] = this.organisation;
    }

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

    let lastError: Error | null = null;
    let lastStatus = 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        lastStatus = response.status;

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

          throw parseApiError(data, response.status);
        }

        return data as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        if (attempt < retries && !(err instanceof TheHiveProjectApiError)) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw err;
      }
    }

    throw lastError || new TheHiveProjectApiError('Request failed', lastStatus);
  }

  async get<T>(path: string, params?: ListQueryParams): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[],
    params?: ListQueryParams
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}

function normalizeInstanceBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error('TheHive instance base URL is required');
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  if (withoutTrailingSlash.endsWith(API_PATH_PREFIX)) {
    return withoutTrailingSlash.slice(0, -API_PATH_PREFIX.length);
  }

  return withoutTrailingSlash;
}
