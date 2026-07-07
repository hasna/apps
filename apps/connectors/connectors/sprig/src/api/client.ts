import type { SprigConfig } from '../types';
import { parseSprigApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.sprig.com';

export type SprigAuthMode = 'api-key' | 'bearer';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | string[] | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  authMode?: SprigAuthMode;
  retries?: number;
  timeout?: number;
  acceptStatuses?: number[];
}

export class SprigClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: SprigConfig) {
    const key = config.apiKey;
    if (!key) {
      throw new Error('API key is required');
    }
    this.apiKey = key;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          return;
        }
        if (Array.isArray(value)) {
          value.forEach((item) => url.searchParams.append(key, String(item)));
        } else {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number, baseDelay = 1000): number {
    return baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  private getAuthHeader(authMode: SprigAuthMode): string {
    return authMode === 'api-key'
      ? `API-Key ${this.apiKey}`
      : `Bearer ${this.apiKey}`;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      params,
      body,
      headers = {},
      authMode = 'bearer',
      retries = 3,
      timeout = 30000,
      acceptStatuses = [],
    } = options;

    const url = this.buildUrl(path, params);
    const requestHeaders: Record<string, string> = {
      Authorization: this.getAuthHeader(authMode),
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

        const isAccepted = acceptStatuses.includes(response.status);
        if (!response.ok && !isAccepted) {
          if (this.isRetryableStatus(response.status) && attempt < retries) {
            const retryAfter = response.headers.get('retry-after');
            const delay = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : this.getRetryDelay(attempt);
            await this.sleep(delay);
            continue;
          }

          throw parseSprigApiError(data, response.status);
        }

        if (isAccepted && (data === undefined || data === '')) {
          return { accepted: true, status: response.status } as T;
        }

        return data as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        if (attempt < retries && !(err instanceof Error && err.name === 'SprigApiError')) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw err;
      }
    }

    throw lastError || parseSprigApiError(undefined, lastStatus);
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | string[] | undefined>,
    authMode: SprigAuthMode = 'bearer',
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, authMode });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[],
    params?: Record<string, string | number | boolean | string[] | undefined>,
    authMode: SprigAuthMode = 'bearer',
    acceptStatuses: number[] = [],
  ): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body as Record<string, unknown>,
      params,
      authMode,
      acceptStatuses,
    });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
