import type { ConnectorConfig } from '../types';
import { ConnectorApiError, parseApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.usecrow.org';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  retries?: number;
  timeout?: number;
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export class ConnectorClient {
  readonly productId: string;
  readonly identityToken?: string;
  readonly baseUrl: string;
  readonly model?: string;
  readonly subdomain?: string;

  constructor(config: ConnectorConfig) {
    if (!config.productId) {
      throw new Error('product_id is required');
    }
    this.productId = config.productId;
    this.identityToken = config.identityToken;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.model = config.model;
    this.subdomain = config.subdomain;
  }

  withProductBody(body: Record<string, unknown> = {}): Record<string, unknown> {
    const merged: Record<string, unknown> = {
      product_id: this.productId,
      ...body,
    };
    if (this.identityToken && merged.identity_token === undefined) {
      merged.identity_token = this.identityToken;
    }
    if (this.model && merged.model === undefined) {
      merged.model = this.model;
    }
    if (this.subdomain && merged.subdomain === undefined) {
      merged.subdomain = this.subdomain;
    }
    return merged;
  }

  identityQuery(
    extra: Record<string, string | number | boolean | undefined> = {},
  ): Record<string, string | number | boolean | undefined> {
    const token = extra.identity_token ?? this.identityToken;
    if (!token) {
      throw new Error('identity_token is required');
    }
    return {
      product_id: this.productId,
      identity_token: token,
      ...extra,
    };
  }

  productQuery(
    extra: Record<string, string | number | boolean | undefined> = {},
  ): Record<string, string | number | boolean | undefined> {
    return {
      product_id: this.productId,
      ...extra,
    };
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

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
      Accept: 'application/json',
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

        if (attempt < retries && !(err instanceof ConnectorApiError)) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw err;
      }
    }

    throw lastError || new ConnectorApiError('Request failed', lastStatus);
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  getProductIdPreview(): string {
    if (this.productId.length > 10) {
      return `${this.productId.substring(0, 6)}...${this.productId.substring(this.productId.length - 4)}`;
    }
    return '***';
  }
}
