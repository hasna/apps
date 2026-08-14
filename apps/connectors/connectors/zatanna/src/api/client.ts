import type { HttpMethod, ZatannaConfig } from '../types';
import { ZatannaApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.zatanna.ai/v1';

export interface RequestOptions {
  method?: HttpMethod;
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class ZatannaClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly authHeader: string;
  readonly defaultWorkspaceId?: string;

  constructor(config: ZatannaConfig) {
    if (!config.apiKey?.trim()) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.authHeader = config.authHeader?.trim() || 'Authorization';
    this.defaultWorkspaceId = config.defaultWorkspaceId?.trim() || undefined;
  }

  static relativePath(path: string): string {
    const clean = path.trim();
    if (!clean) {
      throw new Error('path is required');
    }
    if (/^https?:\/\//i.test(clean)) {
      throw new Error('path must be a relative API path');
    }
    return clean.startsWith('/') ? clean : `/${clean}`;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${ZatannaClient.relativePath(path)}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...extra,
    };

    if (this.authHeader.toLowerCase() === 'authorization') {
      headers.Authorization = `Bearer ${this.apiKey}`;
    } else {
      headers[this.authHeader] = this.apiKey;
    }

    return headers;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);
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

    const text = await response.text();
    let data: unknown = {};

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      let message = typeof text === 'string' ? text.slice(0, 500) : String(text);
      if (typeof data === 'object' && data !== null) {
        const record = data as Record<string, unknown>;
        message = String(record.error ?? record.message ?? message);
      }
      throw new ZatannaApiError(message, response.status, path);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown> });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
