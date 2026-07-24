import type { ApiEnvelope, TotalisConfig, TotalisErrorBody } from '../types';
import { TotalisApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.totalis.trade';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
}

export class TotalisClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(config: TotalisConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private authHeaders(headers: Record<string, string>, auth: boolean): Record<string, string> {
    if (!auth) {
      return headers;
    }

    if (!this.apiKey) {
      throw new Error('API key is required for this endpoint');
    }

    return {
      ...headers,
      'X-API-Key': this.apiKey,
    };
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, auth = true } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...this.authHeaders(headers, auth),
    };

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    let data: unknown;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const errorBody = data as TotalisErrorBody;
      throw new TotalisApiError(
        errorBody?.error?.message || `Totalis API error: ${response.status}`,
        response.status,
        errorBody?.error?.code,
        errorBody?.error?.details,
      );
    }

    return data as T;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    auth = true,
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, auth });
  }

  async post<T>(
    path: string,
    body?: unknown,
    params?: Record<string, string | number | boolean | undefined>,
    auth = true,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params, auth });
  }

  async patch<T>(
    path: string,
    body?: unknown,
    params?: Record<string, string | number | boolean | undefined>,
    auth = true,
  ): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, params, auth });
  }

  getApiKeyPreview(): string {
    if (!this.apiKey) {
      return 'not set';
    }
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export type { ApiEnvelope };
