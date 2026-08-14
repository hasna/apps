import type { QueryValue, WeezeventConfig } from '../types';
import { WeezeventApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.weezevent.com';

export interface RequestOptions {
  method?: 'GET' | 'POST';
  params?: Record<string, QueryValue>;
  body?: URLSearchParams | Record<string, string>;
  retries?: number;
  timeout?: number;
  includeAuth?: boolean;
}

export class WeezeventClient {
  private readonly apiKey: string;
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(config: WeezeventConfig) {
    if (!config.apiKey || !config.accessToken) {
      throw new Error('Weezevent apiKey and accessToken are required');
    }
    this.apiKey = config.apiKey;
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  appendParams(url: URL, params?: Record<string, QueryValue>): void {
    if (!params) return;

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;

      if (Array.isArray(value)) {
        const arrayKey = key.endsWith('[]') ? key : `${key}[]`;
        for (const item of value) {
          url.searchParams.append(arrayKey, String(item));
        }
        continue;
      }

      url.searchParams.append(key, String(value));
    }
  }

  buildUrl(path: string, params?: Record<string, QueryValue>, includeAuth = true): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (includeAuth) {
      url.searchParams.append('api_key', this.apiKey);
      url.searchParams.append('access_token', this.accessToken);
    }
    this.appendParams(url, params);
    return url.toString();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number): number {
    return 1000 * Math.pow(2, attempt) + Math.random() * 1000;
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
      includeAuth = true,
    } = options;

    const url = this.buildUrl(path, params, includeAuth);
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = { method, headers };

    if (body && method === 'POST') {
      if (body instanceof URLSearchParams) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=utf-8';
        fetchOptions.body = body.toString();
      } else {
        headers['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(body);
      }
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

        const text = await response.text();
        let data: unknown = {};
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        }

        if (!response.ok) {
          if (this.isRetryableStatus(response.status) && attempt < retries) {
            const retryAfter = response.headers.get('retry-after');
            const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.getRetryDelay(attempt);
            await this.sleep(delay);
            continue;
          }

          const message =
            typeof data === 'object' && data !== null && 'message' in data
              ? String((data as { message?: string }).message)
              : response.statusText || 'Request failed';
          throw new WeezeventApiError(message, response.status);
        }

        return data as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        if (attempt < retries && !(err instanceof WeezeventApiError)) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw err;
      }
    }

    throw lastError || new WeezeventApiError('Request failed', lastStatus);
  }

  async get<T>(path: string, params?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async postForm<T>(path: string, fields: Record<string, string>, includeAuth = false): Promise<T> {
    const body = new URLSearchParams(fields);
    return this.request<T>(path, { method: 'POST', body, includeAuth });
  }
}
