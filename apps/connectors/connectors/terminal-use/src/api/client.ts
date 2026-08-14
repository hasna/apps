import type { ConnectorConfig, QueryParams } from '../types';
import { ConnectorApiError, parseApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.terminaluse.com';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
  stream?: boolean;
}

export class ConnectorClient {
  private readonly token: string;
  private readonly agentApiKey?: string;
  private readonly baseUrl: string;

  constructor(config: ConnectorConfig) {
    const token = config.token || config.apiKey;
    if (!token) {
      throw new Error('API token is required');
    }

    this.token = token;
    this.agentApiKey = config.agentApiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  assertRelativePath(path: string): string {
    if (!path.startsWith('/')) {
      throw new Error('API path must be relative and start with "/"');
    }
    if (path.startsWith('//') || path.includes('://')) {
      throw new Error('Absolute URLs are not allowed; use a relative API path');
    }
    return path;
  }

  private buildUrl(path: string, params?: QueryParams): string {
    const safePath = this.assertRelativePath(path);
    const url = new URL(`${this.baseUrl}${safePath}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private buildHeaders(extra: Record<string, string> = {}, hasBody = false): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      ...extra,
    };

    if (this.agentApiKey) {
      headers['x-agent-api-key'] = this.agentApiKey;
    }

    if (hasBody) {
      headers['Content-Type'] = 'application/json';
    }

    return headers;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, stream = false } = options;
    const url = this.buildUrl(path, params);
    const hasBody = body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method);

    const fetchOptions: RequestInit = {
      method,
      headers: this.buildHeaders(headers, hasBody),
    };

    if (hasBody) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (stream) {
      if (!response.ok) {
        const text = await response.text();
        let data: unknown = text;
        try {
          data = text ? JSON.parse(text) : text;
        } catch {
          // keep text
        }
        throw parseApiError(data, response.status);
      }
      return response as unknown as T;
    }

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
      throw parseApiError(data, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: unknown, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async put<T>(path: string, body?: unknown, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async patch<T>(path: string, body?: unknown, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, params });
  }

  async delete<T>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  async stream(path: string, params?: QueryParams): Promise<Response> {
    return this.request<Response>(path, { method: 'GET', params, stream: true });
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

  isAuthError(err: unknown): boolean {
    return err instanceof ConnectorApiError && (err.statusCode === 401 || err.statusCode === 403);
  }
}
