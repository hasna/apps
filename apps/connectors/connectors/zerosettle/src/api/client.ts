import type { HttpMethod, ZeroSettleConfig, ZeroSettleErrorBody } from '../types';
import { ZeroSettleApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.zerosettle.io';

export interface RequestOptions {
  method?: HttpMethod;
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export class ZeroSettleClient {
  private readonly publishableKey: string;
  private readonly baseUrl: string;

  constructor(config: ZeroSettleConfig) {
    if (!config.publishableKey) {
      throw new Error('Publishable key is required');
    }
    this.publishableKey = config.publishableKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
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
      'X-ZeroSettle-Key': this.publishableKey,
      Accept: 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body !== undefined && !['GET', 'HEAD'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
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
      const errorBody = (typeof data === 'object' && data !== null ? data : undefined) as ZeroSettleErrorBody | undefined;
      const message =
        errorBody?.message ||
        errorBody?.detail ||
        errorBody?.error ||
        `ZeroSettle API error: ${response.status}`;
      throw new ZeroSettleApiError(message, response.status, errorBody);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  getPublishableKeyPreview(): string {
    if (this.publishableKey.length > 10) {
      return `${this.publishableKey.substring(0, 6)}...${this.publishableKey.substring(this.publishableKey.length - 4)}`;
    }
    return '***';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
