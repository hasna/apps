import type { ConnectorConfig, ListQueryParams, RawRequestOptions } from '../types';
import { ConnectorApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.stabilityapiplatform.com/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: ListQueryParams;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment);
}

export class ConnectorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ConnectorConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  private buildUrl(path: string, params?: ListQueryParams): string {
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

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
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
      throw new ConnectorApiError(
        `Stability Api Platform ${method} ${path} failed with status ${response.status}`,
        response.status,
        typeof data === 'string' ? data : JSON.stringify(data),
      );
    }

    return data as T;
  }

  async get<T>(path: string, params?: ListQueryParams): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[], params?: ListQueryParams): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}

export class StabilityApiPlatformClient extends ConnectorClient {
  listItems(params?: ListQueryParams): Promise<unknown> {
    return this.get('/items', params);
  }

  createItem(body: Record<string, unknown> | unknown[]): Promise<unknown> {
    return this.post('/items', body);
  }

  getItem(itemId: string): Promise<unknown> {
    return this.get(`/items/${encodePathSegment(itemId)}`);
  }

  listEvents(params?: ListQueryParams): Promise<unknown> {
    return this.get('/events', params);
  }

  search(body: Record<string, unknown> | unknown[]): Promise<unknown> {
    return this.post('/search', body);
  }

  rawRequest(options: RawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.request(path, { method, params: query, body, headers });
  }
}
