import type { ConnectorConfig } from '../types';
import { ConnectorApiError, parseApiError } from '../types';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  retries?: number;
  timeout?: number;
}

/**
 * HTTP client for the Teamwork.com API.
 *
 * Teamwork authenticates with HTTP Basic auth: the API token is supplied as the
 * username and any non-empty string as the password. The base URL is site
 * specific (`https://{installation}.teamwork.com`) and all v3 resources live
 * under `/projects/api/v3`.
 */
export class ConnectorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: ConnectorConfig) {
    const key = config.apiKey || config.token;
    if (!key) {
      throw new Error('A Teamwork API token is required (apiKey/token)');
    }
    this.apiKey = key;

    if (config.baseUrl) {
      this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    } else if (config.installation) {
      const site = config.installation.trim();
      // Accept either a bare site name or a full host/URL.
      if (/^https?:\/\//i.test(site)) {
        this.baseUrl = site.replace(/\/+$/, '');
      } else if (site.includes('.')) {
        this.baseUrl = `https://${site.replace(/\/+$/, '')}`;
      } else {
        this.baseUrl = `https://${site}.teamwork.com`;
      }
    } else {
      throw new Error(
        'A Teamwork installation (site name) or baseUrl is required. ' +
          'Set TEAMWORK_INSTALLATION or pass installation/baseUrl.'
      );
    }

    // Basic auth: token as username, arbitrary password.
    const encoded = Buffer.from(`${this.apiKey}:x`).toString('base64');
    this.authHeader = `Basic ${encoded}`;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number, baseDelay: number = 1000): number {
    return baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, retries = 3, timeout = 30000 } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: 'application/json',
      ...headers,
    };

    const hasBody = body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method);
    if (hasBody) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (hasBody) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
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
          if (this.isRetryableStatus(response.status) && attempt < retries) {
            const retryAfter = response.headers.get('retry-after');
            const delay = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : this.getRetryDelay(attempt);

            await this.sleep(delay);
            continue;
          }

          throw parseApiError(data, response.status);
        }

        return data as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        if (attempt < retries && !(err instanceof ConnectorApiError)) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw err;
      }
    }

    throw lastError || new ConnectorApiError('Request failed', lastStatus);
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async put<T>(path: string, body?: Record<string, unknown> | unknown[] | string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown> | unknown[] | string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
