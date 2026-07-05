import type { TypesenseConfig } from '../types';
import { TypesenseApiError } from '../types';

export type QueryParams = Record<string, string | number | boolean | undefined>;

export function buildQuery(params: QueryParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export class TypesenseClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: TypesenseConfig) {
    if (!config.host?.trim()) throw new Error('Typesense host is required');
    if (!config.apiKey?.trim()) throw new Error('Typesense API key is required');
    this.baseUrl = config.host.replace(/\/+$/, '');
    this.apiKey = config.apiKey.trim();
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getApiKey(): string {
    return this.apiKey;
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown> | string;
      params?: QueryParams;
      contentType?: string;
    } = {},
  ): Promise<T> {
    const { method = 'GET', body, params, contentType } = options;
    const url = `${this.baseUrl}${path}${params ? buildQuery(params) : ''}`;
    const headers: Record<string, string> = {
      'X-TYPESENSE-API-KEY': this.apiKey,
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = { method, headers };
    if (body !== undefined) {
      if (typeof body === 'string') {
        headers['Content-Type'] = contentType || 'text/plain';
        fetchOptions.body = body;
      } else {
        headers['Content-Type'] = contentType || 'application/json';
        fetchOptions.body = JSON.stringify(body);
      }
    }

    const response = await fetch(url, fetchOptions);
    if (response.status === 204) return {} as T;

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
      const record = (typeof data === 'object' && data !== null ? data : {}) as { message?: string };
      throw new TypesenseApiError(record.message || response.statusText || 'Request failed', response.status);
    }

    return data as T;
  }

  async requestText(
    path: string,
    options: {
      method?: string;
      body?: string;
      params?: QueryParams;
      contentType?: string;
    } = {},
  ): Promise<string> {
    const { method = 'GET', body, params, contentType } = options;
    const url = `${this.baseUrl}${path}${params ? buildQuery(params) : ''}`;
    const headers: Record<string, string> = {
      'X-TYPESENSE-API-KEY': this.apiKey,
    };

    const fetchOptions: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = contentType || 'text/plain';
      fetchOptions.body = body;
    }

    const response = await fetch(url, fetchOptions);
    const text = await response.text();
    if (!response.ok) {
      throw new TypesenseApiError(text || response.statusText || 'Request failed', response.status);
    }
    return text;
  }
}
