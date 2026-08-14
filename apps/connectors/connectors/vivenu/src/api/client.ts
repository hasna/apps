import type { VivenuConfig } from '../types';
import { VivenuApiError } from '../types';

const DEFAULT_BASE_URL = 'https://vivenu.com';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined> | object;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class VivenuClient {
  private readonly apiKey: string;
  private readonly distributorType: string;
  private readonly baseUrl: string;

  constructor(config: VivenuConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    if (!config.distributorType) {
      throw new Error('Distributor type is required');
    }
    this.apiKey = config.apiKey;
    this.distributorType = config.distributorType;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined> | object): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params as Record<string, string | number | boolean | undefined>).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  encodePathSegment(segment: string): string {
    return encodeURIComponent(segment);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: this.apiKey,
      'x-distributor-type': this.distributorType,
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
      const errorMessage = typeof data === 'object' && data !== null
        ? (data as Record<string, string>).message || JSON.stringify(data)
        : String(data || response.statusText);
      throw new VivenuApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined> | object): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown> });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  getDistributorType(): string {
    return this.distributorType;
  }
}
