import type { ZolvoConfig } from '../types';
import { ZolvoApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.zolvo.com/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** Encode a path segment (e.g. loan IDs with spaces). */
export function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment);
}

export class ZolvoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ZolvoConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
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
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    let data: unknown;
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    if (contentType.includes('application/json') || text.startsWith('{') || text.startsWith('[')) {
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
    } else {
      data = text;
    }

    if (!response.ok) {
      const errorData = (typeof data === 'object' && data !== null ? data : {}) as {
        message?: string;
        error?: string;
      };
      throw new ZolvoApiError(
        errorData.message || errorData.error || `Zolvo API error: ${response.status}`,
        response.status,
        data,
      );
    }

    return data as T;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }
}
