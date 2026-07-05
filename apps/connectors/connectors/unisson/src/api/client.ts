import type { UnissonConfig } from '../types';
import { UnissonApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.unisson.ai/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  retries?: number;
  timeout?: number;
}

/** Encode a path segment (e.g. agent IDs containing spaces). */
export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export class UnissonClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: UnissonConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
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

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      params,
      body,
      headers = {},
      retries = 2,
      timeout = 30_000,
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

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const fetchOptions: RequestInit = {
          method,
          headers: requestHeaders,
          signal: controller.signal,
        };

        if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
          fetchOptions.body = JSON.stringify(body);
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timer);

        if (response.status === 204) {
          return {} as T;
        }

        let data: unknown;
        const text = await response.text();
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        }

        if (!response.ok) {
          const message =
            typeof data === 'object' && data !== null && 'message' in data
              ? String((data as { message?: string }).message)
              : typeof data === 'object' && data !== null
                ? JSON.stringify(data)
                : String(data || response.statusText);

          if ((response.status === 429 || response.status >= 500) && attempt < retries) {
            const retryAfter = Number(response.headers.get('retry-after') || 0);
            await this.sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * (attempt + 1));
            continue;
          }

          throw new UnissonApiError(message, response.status);
        }

        return data as T;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof UnissonApiError) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < retries) {
          await this.sleep(500 * (attempt + 1));
          continue;
        }
      }
    }

    throw lastError ?? new UnissonApiError('Request failed', 0);
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: unknown,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }
}
