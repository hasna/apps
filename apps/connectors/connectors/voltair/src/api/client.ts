import type { QueryParams, VoltairConfig } from '../types';
import { VoltairApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.voltair.ai/v1';

export interface VoltairRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  query?: QueryParams;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * Encode a path segment so IDs with spaces/special chars are safe in URLs.
 */
export function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment);
}

/**
 * Voltair API client with Bearer token authentication.
 */
export class VoltairClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: VoltairConfig) {
    if (!config.apiKey) {
      throw new Error('Voltair API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  buildUrl(path: string, query?: QueryParams): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async request<T>(path: string, options: VoltairRequestOptions = {}): Promise<T> {
    const { method = 'GET', body, query, headers = {}, timeout = 60000 } = options;
    const url = this.buildUrl(path, query);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: requestHeaders,
        signal: controller.signal,
      };

      if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
        requestHeaders['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);

      if (response.status === 204) {
        return {} as T;
      }

      let data: unknown;
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const text = await response.text();
        data = text ? JSON.parse(text) : undefined;
      } else {
        data = await response.text();
      }

      if (!response.ok) {
        let errorMessage = `Voltair API Error: ${response.status} ${response.statusText}`;
        let errorCode: string | undefined;

        if (typeof data === 'object' && data !== null) {
          const errData = data as Record<string, unknown>;
          errorCode = errData.code as string | undefined;
          errorMessage = String(
            errData.message || errData.error || errData.detail || errorMessage,
          );
        } else if (typeof data === 'string' && data) {
          errorMessage = data;
        }

        throw new VoltairApiError(errorMessage, response.status, errorCode);
      }

      return data as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async get<T>(path: string, query?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'GET', query });
  }

  async post<T>(path: string, body?: Record<string, unknown>, query?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, query });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 8) {
      return `${this.apiKey.substring(0, 4)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
