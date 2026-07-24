import type { StoplightConfig, StoplightErrorResponse } from '../types';
import { StoplightApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://stoplight.io/api';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

/**
 * Low-level HTTP client for the Stoplight API.
 *
 * Authentication note: Stoplight workspace tokens and personal access tokens
 * are sent verbatim in the `Authorization` header WITHOUT a `Bearer` prefix.
 * (The API rejects a `Bearer <token>` value as "Missing authorization.")
 */
export class StoplightClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: StoplightConfig) {
    if (!config.token) {
      throw new Error('API token is required');
    }
    this.token = config.token;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);

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
      // Stoplight tokens are passed raw (no "Bearer" prefix).
      'Authorization': this.token,
      'Accept': 'application/json',
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

    const response = await fetch(url, fetchOptions);

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    // Parse response
    let data: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json') || contentType.includes('application/problem+json')) {
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
      const err = (data && typeof data === 'object' ? data : {}) as StoplightErrorResponse;
      const message =
        err.message ||
        err.title ||
        (typeof data === 'string' && data ? data : response.statusText) ||
        `Request failed with status ${response.status}`;
      throw new StoplightApiError(message, response.status, err.code, err.type, err.data);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async put<T>(path: string, body?: Record<string, unknown> | unknown[] | string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown> | unknown[] | string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getTokenPreview(): string {
    if (this.token.length > 10) {
      return `${this.token.substring(0, 6)}...${this.token.substring(this.token.length - 4)}`;
    }
    return '***';
  }
}
