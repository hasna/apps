import type { XmlConfig } from '../types';
import { ConnectorApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.xml.com/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

/**
 * Encode a path segment for safe URL construction.
 */
export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Low-level HTTP client for the XML.com REST API.
 */
export class XmlClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: XmlConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
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
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
      signal: AbortSignal.timeout(30000),
    };

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;

    if (contentType.includes('application/json')) {
      const text = await response.text();
      data = text ? JSON.parse(text) : {};
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      throw new ConnectorApiError(
        `XML API ${method} ${path} failed with status ${response.status}`,
        response.status,
        typeof data === 'string' ? data : JSON.stringify(data)
      );
    }

    return data as T;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[],
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
