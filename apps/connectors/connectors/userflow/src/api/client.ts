import type { UserflowConfig, QueryParams } from '../types';
import { USERFLOW_API_VERSION, parseUserflowError } from '../types';

const DEFAULT_BASE_URL = 'https://api.userflow.com';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
  retries?: number;
  timeout?: number;
}

export class UserflowClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: UserflowConfig) {
    const key = (config.apiKey || config.token || '').trim();
    if (!key) {
      throw new Error('Userflow API key is required');
    }
    this.apiKey = key;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  private buildUrl(path: string, params?: QueryParams): string {
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number, baseDelay = 1000): number {
    return baseDelay * 2 ** attempt + Math.random() * 1000;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, retries = 3, timeout = 30000 } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Userflow-Version': USERFLOW_API_VERSION,
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
      fetchOptions.body = JSON.stringify(body);
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
          const text = await response.text();
          if (text) {
            try {
              data = JSON.parse(text);
            } catch {
              data = text;
            }
          }
        }

        if (!response.ok) {
          if (this.isRetryableStatus(response.status) && attempt < retries) {
            const retryAfter = response.headers.get('retry-after');
            const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.getRetryDelay(attempt);
            await this.sleep(delay);
            continue;
          }

          throw parseUserflowError(data, response.status);
        }

        return data as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        if (attempt < retries && !(err instanceof Error && err.name === 'UserflowApiError')) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw err;
      }
    }

    throw lastError || parseUserflowError(null, lastStatus);
  }

  async get<T>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: unknown,
    params?: QueryParams,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async delete<T>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
