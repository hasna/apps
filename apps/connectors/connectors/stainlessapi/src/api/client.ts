import type { StainlessConfig } from '../types';
import { ENVIRONMENTS, StainlessApiError } from '../types';

const API_PREFIX = '/v0';

export type QueryParams = Record<string, string | number | boolean | undefined>;
export type RequestBody = object | unknown[] | string;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: QueryParams;
  body?: RequestBody;
  headers?: Record<string, string>;
}

/**
 * Low-level HTTP client for the Stainless REST API.
 *
 * Authentication uses the `x-stainless-api-key` header (not a Bearer token).
 */
export class StainlessClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: StainlessConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    const environmentUrl = ENVIRONMENTS[config.environment || 'production'];
    // Trim any trailing slash so path joins stay predictable.
    this.baseUrl = (config.baseUrl || environmentUrl).replace(/\/$/, '');
  }

  private buildUrl(path: string, params?: QueryParams): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${API_PREFIX}${normalizedPath}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'x-stainless-api-key': this.apiKey,
      Accept: 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = { method, headers: requestHeaders };

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

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
      const errorData = data as { error?: ApiErrorLike; message?: string } | undefined;
      const detail = errorData?.error;
      const message =
        detail?.message || errorData?.message || response.statusText || `HTTP ${response.status}`;
      throw new StainlessApiError(message, response.status, detail);
    }

    return data as T;
  }

  get<T>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  post<T>(path: string, body?: RequestBody, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  patch<T>(path: string, body?: RequestBody): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  put<T>(path: string, body?: RequestBody): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  /** Redacted preview of the API key for display/debugging. */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}

interface ApiErrorLike {
  type?: string;
  message?: string;
}
