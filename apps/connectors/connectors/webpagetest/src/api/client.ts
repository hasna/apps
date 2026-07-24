import type { WebPageTestConfig } from '../types';
import { WebPageTestApiError } from '../types';

export const DEFAULT_REST_BASE_URL = 'https://api.webpagetest.org/v1';
export const DEFAULT_CLASSIC_BASE_URL = 'https://www.webpagetest.org';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  baseUrl?: string;
}

export class WebPageTestClient {
  private readonly apiKey: string;
  private readonly restBaseUrl: string;
  private readonly classicBaseUrl: string;

  constructor(config: WebPageTestConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.restBaseUrl = (config.baseUrl || DEFAULT_REST_BASE_URL).replace(/\/$/, '');
    this.classicBaseUrl = (config.classicBaseUrl || DEFAULT_CLASSIC_BASE_URL).replace(/\/$/, '');
  }

  getRestBaseUrl(): string {
    return this.restBaseUrl;
  }

  getClassicBaseUrl(): string {
    return this.classicBaseUrl;
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    baseUrl = this.restBaseUrl,
  ): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${baseUrl}${normalizedPath}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Accept: 'application/json',
      'X-WPT-API-KEY': this.apiKey,
      ...extra,
    };
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      params,
      body,
      headers = {},
      baseUrl = this.restBaseUrl,
    } = options;

    const url = this.buildUrl(path, params, baseUrl);
    const requestHeaders = this.authHeaders(headers);

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

    if (response.status === 204) {
      return {} as T;
    }

    let data: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const text = await response.text();
      data = text ? JSON.parse(text) : {};
    } else {
      const text = await response.text();
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const errorBody = typeof data === 'object' && data !== null
        ? data as { message?: string; statusText?: string; errors?: string[] }
        : undefined;
      const message = errorBody?.message
        || errorBody?.statusText
        || errorBody?.errors?.join(', ')
        || response.statusText
        || 'Request failed';
      throw new WebPageTestApiError(message, response.status, errorBody);
    }

    return data as T;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    baseUrl?: string,
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, baseUrl });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[],
    params?: Record<string, string | number | boolean | undefined>,
    baseUrl?: string,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params, baseUrl });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
