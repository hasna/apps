import type { UPSConfig, UPSHttpMethod } from '../types';
import { UPSApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.ups.com/v1';

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export class UPSClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: UPSConfig) {
    if (!config.apiKey) throw new Error('UPS apiKey is required');
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async request<T>(
    path: string,
    options: {
      method?: UPSHttpMethod;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const { method = 'GET', body, params, headers = {} } = options;
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = { method, headers: requestHeaders };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (response.status === 204) return {} as T;

    const text = await response.text();
    let data: unknown;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const message =
        (typeof data === 'object' && data !== null && 'message' in data
          ? String((data as { message?: string }).message)
          : undefined) ||
        (typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error?: string }).error)
          : undefined) ||
        response.statusText ||
        'Request failed';
      throw new UPSApiError(message, response.status);
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
}
