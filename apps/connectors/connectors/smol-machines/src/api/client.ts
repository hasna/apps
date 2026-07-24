import type { SmolMachinesConfig } from '../types';
import { SmolMachinesApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.smolmachines.com/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class SmolMachinesClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(config: SmolMachinesConfig = {}) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
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

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...headers,
    };

    if (this.apiKey) {
      requestHeaders.Authorization = `Bearer ${this.apiKey}`;
    }

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
      let errorMessage = String(data || response.statusText);
      if (typeof data === 'object' && data !== null) {
        const errorObj = data as { error?: string; message?: string; detail?: string };
        errorMessage = errorObj.error || errorObj.message || errorObj.detail || JSON.stringify(data);
      }
      throw new SmolMachinesApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | object,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async put<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | object,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  hasApiKey(): boolean {
    return Boolean(this.apiKey);
  }
}
