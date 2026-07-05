import type { WufooConfig, OutputFormat } from '../types';
import { WufooApiError, parseWufooError } from '../types';

/** Wufoo accepts any password value with HTTP Basic auth; API key is the username. */
const BASIC_AUTH_PASSWORD = 'x';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, string | number | boolean | undefined>;
  formBody?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  format?: OutputFormat;
  retries?: number;
  timeout?: number;
}

export function buildWufooBaseUrl(subdomain: string, baseUrl?: string): string {
  if (baseUrl) {
    return baseUrl.replace(/\/$/, '');
  }
  return `https://${subdomain}.wufoo.com/api/v3`;
}

/** Encode form/report identifiers for use as a single URL path segment. */
export function encodeResourceId(identifier: string): string {
  return encodeURIComponent(identifier);
}

export class WufooClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: WufooConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    if (!config.subdomain && !config.baseUrl) {
      throw new Error('Subdomain is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = buildWufooBaseUrl(config.subdomain, config.baseUrl);
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private getAuthHeader(): string {
    const credentials = `${this.apiKey}:${BASIC_AUTH_PASSWORD}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number, baseDelay = 1000): number {
    return baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  private encodeFormBody(body: Record<string, string | number | boolean | undefined>): string {
    const params = new URLSearchParams();
    Object.entries(body).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    });
    return params.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      params,
      body,
      formBody,
      headers = {},
      retries = 3,
      timeout = 30000,
    } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      Accept: 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (formBody && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      fetchOptions.body = this.encodeFormBody(formBody);
    } else if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    let lastError: Error | null = null;
    let lastStatus = 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        lastStatus = response.status;

        if (response.status === 204) {
          return {} as T;
        }

        let data: unknown;
        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
          const text = await response.text();
          data = text ? JSON.parse(text) : undefined;
        } else {
          const text = await response.text();
          try {
            data = text ? JSON.parse(text) : undefined;
          } catch {
            data = text;
          }
        }

        if (!response.ok) {
          if (this.isRetryableStatus(response.status) && attempt < retries) {
            const retryAfter = response.headers.get('retry-after');
            const delay = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : this.getRetryDelay(attempt);
            await this.sleep(delay);
            continue;
          }

          throw parseWufooError(data, response.status);
        }

        return data as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        if (attempt < retries && !(err instanceof WufooApiError)) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw err;
      }
    }

    throw lastError || new WufooApiError('Request failed', lastStatus);
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async postForm<T>(
    path: string,
    formBody: Record<string, string | number | boolean | undefined>,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', formBody, params });
  }

  async putForm<T>(
    path: string,
    formBody: Record<string, string | number | boolean | undefined>,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'PUT', formBody, params });
  }

  async delete<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
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
