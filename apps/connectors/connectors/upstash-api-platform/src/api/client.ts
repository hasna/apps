import type { UpstashApiPlatformConfig } from '../types';
import { UpstashApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.upstash.com/v2';
export const AUDIT_LOGS_BASE_URL = 'https://api.upstash.com';
const ALLOWED_AUTH_ORIGIN = 'https://api.upstash.com';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string | object;
  headers?: Record<string, string>;
  baseUrl?: string;
  retries?: number;
}

export class UpstashApiPlatformClient {
  private readonly email: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: UpstashApiPlatformConfig) {
    if (!config.email || !config.apiKey) {
      throw new Error('Email and API key are required');
    }
    this.email = config.email;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private getAuthHeader(): string {
    const credentials = `${this.email}:${this.apiKey}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  private buildUrl(
    path: string,
    baseUrl: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): string {
    const url = new URL(`${baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private assertAllowedAuthenticatedBaseUrl(baseUrl: string): void {
    const url = new URL(baseUrl);

    if (url.origin !== ALLOWED_AUTH_ORIGIN || url.username || url.password) {
      throw new Error('Refusing to send Upstash credentials to a non-Upstash API host');
    }
  }

  private async parseResponse(response: Response): Promise<unknown> {
    if (response.status === 204) {
      return {};
    }

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    if (!text) {
      return {};
    }

    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    return text;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      params,
      body,
      headers = {},
      baseUrl = this.baseUrl,
      retries = 2,
    } = options;

    this.assertAllowedAuthenticatedBaseUrl(baseUrl);
    const url = this.buildUrl(path, baseUrl, params);
    const requestHeaders: Record<string, string> = {
      Authorization: this.getAuthHeader(),
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

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(url, fetchOptions);
      const data = await this.parseResponse(response);

      if (response.ok) {
        return data as T;
      }

      const message =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error: unknown }).error)
          : typeof data === 'string' && data
            ? data
            : response.statusText;

      const apiError = new UpstashApiError(message || `HTTP ${response.status}`, response.status, data);

      if (attempt < retries && (response.status === 429 || response.status >= 500)) {
        lastError = apiError;
        await Bun.sleep(250 * (attempt + 1));
        continue;
      }

      throw apiError;
    }

    throw lastError ?? new UpstashApiError('Request failed', 500);
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    options?: Omit<RequestOptions, 'method' | 'params' | 'body'>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, ...options });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | object,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, ...options });
  }

  async put<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | object,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, ...options });
  }

  async delete<T>(
    path: string,
    options?: Omit<RequestOptions, 'method'>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', ...options });
  }

  getEmail(): string {
    return this.email;
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
