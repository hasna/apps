import type { RawRequestOptions, SteelDevConfig } from '../types';
import { SteelDevApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.steel.dev/v1';

export interface SteelDevRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  timeout?: number;
}

/**
 * Steel Dev API client.
 * Auth: canonical `steel-api-key` header per https://docs.steel.dev/overview/authentication
 */
export class SteelDevClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: SteelDevConfig) {
    if (!config.apiKey) {
      throw new Error('Steel API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  getAuthHeaders(): Record<string, string> {
    return {
      'steel-api-key': this.apiKey,
      Accept: 'application/json',
    };
  }

  buildUrl(path: string, query?: SteelDevRequestOptions['query']): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async request<T>(path: string, options: SteelDevRequestOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {}, query, timeout = 60000 } = options;
    const url = this.buildUrl(path, query);

    const requestHeaders: Record<string, string> = {
      ...this.getAuthHeaders(),
      ...headers,
    };

    if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
      requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: requestHeaders,
        signal: controller.signal,
      };

      if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);

      if (response.status === 204) {
        return {} as T;
      }

      let data: unknown;
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();

      if (text && contentType.includes('application/json')) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      } else if (text) {
        data = text;
      }

      if (!response.ok) {
        let errorMessage = `Steel API Error: ${response.status} ${response.statusText}`;
        let errorCode: string | undefined;

        if (typeof data === 'object' && data !== null) {
          const errData = data as Record<string, unknown>;
          errorCode = errData.code as string | undefined;
          errorMessage = (errData.message || errData.error || errData.detail || errorMessage) as string;
        } else if (typeof data === 'string' && data) {
          errorMessage = data;
        }

        throw new SteelDevApiError(errorMessage, response.status, errorCode);
      }

      return data as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async get<T>(path: string, query?: SteelDevRequestOptions['query']): Promise<T> {
    return this.request<T>(path, { method: 'GET', query });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  async rawRequest<T>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, body, headers, query } = options;
    return this.request<T>(path, {
      method: method as SteelDevRequestOptions['method'],
      body,
      headers,
      query,
    });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 8) {
      return `${this.apiKey.substring(0, 4)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
