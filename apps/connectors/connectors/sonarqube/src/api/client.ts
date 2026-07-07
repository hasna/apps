import type { OutputFormat, QueryParamValue, SonarQubeConfig, SonarQubeError, SonarQubeErrorResponse } from '../types';
import { SonarQubeApiError } from '../types';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, QueryParamValue>;
  body?: Record<string, QueryParamValue>;
  headers?: Record<string, string>;
  format?: OutputFormat;
}

export class SonarQubeClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: SonarQubeConfig) {
    if (!config.token) {
      throw new Error('SonarQube token is required');
    }
    if (!config.baseUrl) {
      throw new Error('SonarQube base URL is required');
    }
    this.token = config.token;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  private getAuthHeader(): string {
    const credentials = Buffer.from(`${this.token}:`).toString('base64');
    return `Basic ${credentials}`;
  }

  private buildUrl(path: string, params?: Record<string, QueryParamValue>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          return;
        }
        if (Array.isArray(value)) {
          url.searchParams.append(key, value.join(','));
          return;
        }
        url.searchParams.append(key, String(value));
      });
    }

    return url.toString();
  }

  private encodeFormBody(body: Record<string, QueryParamValue>): string {
    const params = new URLSearchParams();
    Object.entries(body).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      if (Array.isArray(value)) {
        params.append(key, value.join(','));
        return;
      }
      params.append(key, String(value));
    });
    return params.toString();
  }

  private parseError(data: unknown, status: number): SonarQubeApiError {
    if (typeof data === 'object' && data !== null) {
      const errorData = data as SonarQubeErrorResponse;
      if (errorData.errors?.length) {
        const message = errorData.errors.map((e) => e.msg).join('; ');
        return new SonarQubeApiError(message, status, errorData.errors);
      }
    }

    const message = typeof data === 'string'
      ? data
      : typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : `Request failed with status ${status}`;

    return new SonarQubeApiError(message, status);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      Accept: 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      fetchOptions.body = this.encodeFormBody(body);
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
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
    }

    if (!response.ok) {
      throw this.parseError(data, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, QueryParamValue>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, QueryParamValue>, params?: Record<string, QueryParamValue>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  getTokenPreview(): string {
    if (this.token.length > 10) {
      return `${this.token.substring(0, 6)}...${this.token.substring(this.token.length - 4)}`;
    }
    return '***';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
