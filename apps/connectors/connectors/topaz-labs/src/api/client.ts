import type { TopazLabsConfig } from '../types';
import { TopazLabsApiError, parseApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.topazlabs.com/image/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: BodyInit | Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
  retries?: number;
  timeout?: number;
}

export class TopazLabsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: TopazLabsConfig) {
    const key = config.apiKey || config.token;
    if (!key) {
      throw new Error('Topaz Labs apiKey is required');
    }
    this.apiKey = key;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
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

  private isBodyInit(body: RequestOptions['body']): body is BodyInit {
    return (
      body instanceof FormData ||
      body instanceof URLSearchParams ||
      body instanceof Blob ||
      body instanceof ArrayBuffer ||
      ArrayBuffer.isView(body) ||
      typeof body === 'string'
    );
  }

  private buildFetchBody(
    body: RequestOptions['body'],
    headers: Record<string, string>,
  ): BodyInit | undefined {
    if (body === undefined || body === null) {
      return undefined;
    }
    if (body instanceof FormData) {
      return body;
    }
    if (this.isBodyInit(body)) {
      return body;
    }
    headers['Content-Type'] = 'application/json';
    return JSON.stringify(body);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, retries = 3, timeout = 30000 } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'X-API-Key': this.apiKey,
      Accept: 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = { method, headers: requestHeaders };
    const fetchBody = this.buildFetchBody(body, requestHeaders);
    if (fetchBody !== undefined) {
      fetchOptions.body = fetchBody;
    }

    let lastError: Error | null = null;
    let lastStatus = 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
        clearTimeout(timeoutId);
        lastStatus = response.status;

        if (response.status === 204) {
          return {} as T;
        }

        let data: unknown;
        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();

        if (contentType.includes('application/json') && text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        } else if (text) {
          data = text;
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

        return (data ?? {}) as T;
      } catch (err) {
        let caught = err instanceof Error ? err : new Error(String(err));
        if (caught.name === 'AbortError') {
          caught = new Error(`Request timeout after ${timeout}ms`);
        }
        lastError = caught;
        if (attempt < retries && !(caught instanceof TopazLabsApiError)) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }
        throw caught;
      }
    }

    throw lastError || new TopazLabsApiError('Request failed', lastStatus);
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: RequestOptions['body']): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  async patch<T>(path: string, body?: RequestOptions['body']): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
