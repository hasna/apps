import type { SmartsheetConfig, SmartsheetErrorResponse } from '../types';
import { SmartsheetApiError } from '../types';

const API_BASE_URL = 'https://api.smartsheet.com/2.0';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, string | number | boolean | string[] | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class SmartsheetClient {
  private readonly accessToken: string;

  constructor(config: SmartsheetConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required');
    }
    this.accessToken = config.accessToken;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): string {
    const url = new URL(`${API_BASE_URL}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          if (Array.isArray(value)) {
            url.searchParams.set(key, value.join(','));
          } else {
            url.searchParams.set(key, String(value));
          }
        }
      });
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: 'application/json',
      ...headers,
    };

    if (body && ['POST', 'PUT'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT'].includes(method)) {
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
      let errorMessage: string;
      let errorCode: number | undefined;
      let refId: string | undefined;

      if (typeof data === 'object' && data !== null) {
        const errorData = data as SmartsheetErrorResponse;
        errorMessage = errorData.message || JSON.stringify(data);
        errorCode = errorData.errorCode;
        refId = errorData.refId;
      } else {
        errorMessage = String(data || response.statusText);
      }

      throw new SmartsheetApiError(errorMessage, response.status, errorCode, refId);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[]): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  async put<T>(path: string, body?: Record<string, unknown> | unknown[]): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getAccessTokenPreview(): string {
    if (this.accessToken.length > 10) {
      return `${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }
}
