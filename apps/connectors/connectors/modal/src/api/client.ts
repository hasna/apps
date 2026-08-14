import type { ModalConfig } from '../types';
import { ModalApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.modal.com/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class ModalClient {
  private readonly tokenId: string;
  private readonly tokenSecret: string;
  private readonly baseUrl: string;

  constructor(config: ModalConfig) {
    if (!config.tokenId || !config.tokenSecret) {
      throw new Error('Token ID and Token Secret are required');
    }
    this.tokenId = config.tokenId;
    this.tokenSecret = config.tokenSecret;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }
    return url.toString();
  }

  private getAuthHeader(): string {
    const credentials = Buffer.from(`${this.tokenId}:${this.tokenSecret}`).toString('base64');
    return `Basic ${credentials}`;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': this.getAuthHeader(),
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
      throw new ModalApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown> });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  getTokenPreview(): string {
    if (this.tokenId.length > 8) {
      return `${this.tokenId.substring(0, 4)}...${this.tokenId.substring(this.tokenId.length - 4)}`;
    }
    return '***';
  }
}
