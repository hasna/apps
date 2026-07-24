import type { UpCloudConfig, OutputFormat } from '../types';
import { parseUpCloudError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.upcloud.com/1.3';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
}

export class UpCloudClient {
  private readonly username: string;
  private readonly password: string;
  private readonly baseUrl: string;

  constructor(config: UpCloudConfig) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error('API username and password are required');
    }
    this.username = config.apiKey;
    this.password = config.apiSecret;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private buildAuthHeader(): string {
    const credentials = `${this.username}:${this.password}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
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

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': this.buildAuthHeader(),
      'Accept': 'application/json',
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
      throw parseUpCloudError(data, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async put<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getUsernamePreview(): string {
    if (this.username.length > 8) {
      return `${this.username.substring(0, 4)}...${this.username.substring(this.username.length - 4)}`;
    }
    return '***';
  }
}
