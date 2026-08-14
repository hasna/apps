import type { TogglConfig, TogglError } from '../types';
import { TogglApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.track.toggl.com/api/v9';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined | string[]>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class TogglClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(config: TogglConfig) {
    if (!config.apiToken) {
      throw new Error('API token is required');
    }
    this.apiToken = config.apiToken;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private buildAuthHeader(): string {
    const credentials = Buffer.from(`${this.apiToken}:api_token`).toString('base64');
    return `Basic ${credentials}`;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined | string[]>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') {
          continue;
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
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
      Authorization: this.buildAuthHeader(),
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
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    let data: unknown;
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    if (contentType.includes('application/json') && text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else {
      data = text || undefined;
    }

    if (!response.ok) {
      const errorData = data as TogglError | string | null;
      let errorMessage = response.statusText;

      if (typeof errorData === 'string' && errorData) {
        errorMessage = errorData;
      } else if (errorData && typeof errorData === 'object') {
        errorMessage = errorData.message || errorData.error || errorData.description || errorMessage;
      }

      throw new TogglApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined | string[]>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | object,
    params?: Record<string, string | number | boolean | undefined | string[]>
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async put<T>(
    path: string,
    body?: Record<string, unknown> | object,
    params?: Record<string, string | number | boolean | undefined | string[]>
  ): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  async patch<T>(
    path: string,
    body?: Record<string, unknown> | object,
    params?: Record<string, string | number | boolean | undefined | string[]>
  ): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined | string[]>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getApiTokenPreview(): string {
    if (this.apiToken.length > 10) {
      return `${this.apiToken.substring(0, 6)}...${this.apiToken.substring(this.apiToken.length - 4)}`;
    }
    return '***';
  }

  getAuthHeader(): string {
    return this.buildAuthHeader();
  }
}
