import type { TidioConfig } from '../types';
import { parseTidioError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.tidio.com/';
export const TIDIO_ACCEPT_HEADER = 'application/json; version=1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string | null;
  headers?: Record<string, string>;
  retries?: number;
}

export class TidioClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;

  constructor(config: TidioConfig) {
    if (!config.clientId) {
      throw new Error('Client ID is required');
    }
    if (!config.clientSecret) {
      throw new Error('Client secret is required');
    }
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path.replace(/^\//, ''), this.baseUrl);

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
    const { method = 'GET', params, body, headers = {}, retries = 3 } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Accept': TIDIO_ACCEPT_HEADER,
      'X-Tidio-Openapi-Client-Id': this.clientId,
      'X-Tidio-Openapi-Client-Secret': this.clientSecret,
      ...headers,
    };

    if (body !== undefined && body !== null && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body !== undefined && body !== null && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(url, fetchOptions);

      if (response.status === 204) {
        return undefined as T;
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

        throw parseTidioError(data, response.status);
      }

      return data as T;
    }

    throw new Error('Request failed after retries');
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async put<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getClientIdPreview(): string {
    if (this.clientId.length > 10) {
      return `${this.clientId.substring(0, 6)}...${this.clientId.substring(this.clientId.length - 4)}`;
    }
    return '***';
  }
}
