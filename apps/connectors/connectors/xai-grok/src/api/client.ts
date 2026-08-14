import type { XAIGrokConfig, ApiErrorDetail } from '../types';
import { XAIGrokApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.x.ai/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string | FormData;
  headers?: Record<string, string>;
  responseType?: 'json' | 'text' | 'binary';
}

export class XAIGrokClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: XAIGrokConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalized}`);

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
    const { method = 'GET', params, body, headers = {}, responseType = 'json' } = options;
    const url = this.buildUrl(path, params);
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method) && !isFormData) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (isFormData) {
        fetchOptions.body = body;
      } else {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    if (responseType === 'binary') {
      if (!response.ok) {
        const text = await response.text();
        throw new XAIGrokApiError(text || response.statusText, response.status);
      }
      return (await response.arrayBuffer()) as T;
    }

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;

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
      const errorData = data as { error?: { message?: string; type?: string; code?: string } } | undefined;
      const errorMessage = errorData?.error?.message || response.statusText;
      throw new XAIGrokApiError(errorMessage, response.status, errorData?.error as ApiErrorDetail | undefined);
    }

    if (responseType === 'text') {
      return data as T;
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | FormData,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  async getBinary(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<ArrayBuffer> {
    return this.request<ArrayBuffer>(path, { method: 'GET', params, responseType: 'binary' });
  }

  async postBinary(
    path: string,
    body?: Record<string, unknown> | FormData,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<ArrayBuffer> {
    return this.request<ArrayBuffer>(path, { method: 'POST', body, params, responseType: 'binary' });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
