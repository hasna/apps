import type { TrackjsConfig } from '../types';
import { TrackjsApiError, parseApiError } from '../types';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  retries?: number;
  timeout?: number;
}

export class TrackjsClient {
  private readonly apiKey: string;
  private readonly customerId: string;
  private readonly baseUrl: string;
  private readonly useKeyQueryParam: boolean;

  constructor(config: TrackjsConfig) {
    if (!config.apiKey) {
      throw new Error('TrackJS API key is required');
    }
    if (!config.customerId) {
      throw new Error('TrackJS customer ID is required');
    }

    this.apiKey = config.apiKey;
    this.customerId = config.customerId;
    this.useKeyQueryParam = config.useKeyQueryParam ?? false;
    const root = (config.baseUrl || 'https://api.trackjs.com').replace(/\/$/, '');
    this.baseUrl = `${root}/${this.customerId}/v1`;
  }

  getCustomerId(): string {
    return this.customerId;
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

    if (this.useKeyQueryParam) {
      url.searchParams.append('key', this.apiKey);
    }

    return url.toString();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number, baseDelay: number = 1000): number {
    return baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, retries = 3, timeout = 30000 } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Accept: 'application/json',
    };

    if (!this.useKeyQueryParam) {
      requestHeaders.Authorization = this.apiKey;
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

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
          data = text ? JSON.parse(text) : undefined;
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

        if (attempt < retries && !(err instanceof TrackjsApiError)) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw err;
      }
    }

    throw lastError || new TrackjsApiError('Request failed', lastStatus);
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }
}
