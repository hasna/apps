import type { VoygrConfig } from '../types';
import { VoygrApiError, parseApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://dev.voygr.tech';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  authenticated?: boolean;
  retries?: number;
  timeout?: number;
}

export class VoygrClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(config: VoygrConfig = {}) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
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

  private buildHeaders(options: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };

    if (options.authenticated !== false && this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    return headers;
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
    const {
      method = 'GET',
      params,
      body,
      retries = 3,
      timeout = 30000,
      authenticated = true,
    } = options;

    const url = this.buildUrl(path, params);
    const headers = this.buildHeaders({ ...options, authenticated });

    if (authenticated && !this.apiKey) {
      throw new Error('VOYGR API key is required for this operation');
    }

    const fetchOptions: RequestInit = { method, headers };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
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
          data = text ? JSON.parse(text) : {};
        } else {
          data = await response.text();
        }

        if (!response.ok) {
          if (this.isRetryableStatus(response.status) && attempt < retries) {
            const retryAfter = response.headers.get('retry-after');
            const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.getRetryDelay(attempt);
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

        if (attempt < retries && !(lastError instanceof VoygrApiError)) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new VoygrApiError('Request failed', lastStatus);
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    authenticated = true,
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, authenticated });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown>,
    options: Omit<RequestOptions, 'method' | 'body'> = {},
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  hasApiKey(): boolean {
    return Boolean(this.apiKey);
  }
}
