import type { SplunkCloudConfig } from '../types';
import { SplunkCloudApiError, parseApiError } from '../types';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  /**
   * Body for write requests. Splunk's REST API expects form-urlencoded bodies,
   * so a plain object is encoded as application/x-www-form-urlencoded.
   */
  body?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  retries?: number;
  timeout?: number;
}

/**
 * Low-level HTTP client for the Splunk Cloud Platform REST API (splunkd
 * management endpoint). Handles URL building, output_mode=json injection,
 * Bearer/Basic auth, form-encoded write bodies, retry/backoff, and error
 * parsing.
 */
export class SplunkCloudClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly tokenForPreview: string;
  private readonly retries: number;
  private readonly timeout: number;

  constructor(config: SplunkCloudConfig) {
    if (!config.baseUrl) {
      throw new Error('Base URL is required (e.g. https://<stack>.splunkcloud.com:8089)');
    }

    if (config.token) {
      this.authHeader = `Bearer ${config.token}`;
      this.tokenForPreview = config.token;
    } else if (config.username && config.password) {
      const encoded = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      this.authHeader = `Basic ${encoded}`;
      this.tokenForPreview = config.username;
    } else {
      throw new Error('Authentication is required: provide a token or username and password');
    }

    // Normalize base URL: strip a single trailing slash.
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.retries = config.retries ?? 3;
    this.timeout = config.timeout ?? 30000;
  }

  buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    // Always request JSON output from splunkd.
    url.searchParams.set('output_mode', 'json');

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number, baseDelay = 1000): number {
    return baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  private encodeBody(body: Record<string, string | number | boolean | undefined>): string {
    const search = new URLSearchParams();
    Object.entries(body).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        search.append(key, String(value));
      }
    });
    return search.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, retries = this.retries, timeout = this.timeout } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': this.authHeader,
      'Accept': 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = { method, headers: requestHeaders };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      fetchOptions.body = this.encodeBody(body);
    }

    let lastError: Error | null = null;
    let lastStatus = 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        let response: Response;
        try {
          response = await fetch(url, { ...fetchOptions, signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }

        lastStatus = response.status;

        if (response.status === 204) {
          return {} as T;
        }

        let data: unknown;
        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();
        if (text) {
          if (contentType.includes('application/json') || text.startsWith('{') || text.startsWith('[')) {
            try {
              data = JSON.parse(text);
            } catch {
              data = text;
            }
          } else {
            data = text;
          }
        }

        if (!response.ok) {
          if (this.isRetryableStatus(response.status) && attempt < retries) {
            const retryAfter = response.headers.get('retry-after');
            const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.getRetryDelay(attempt);
            await this.sleep(delay);
            continue;
          }
          throw parseApiError(data, response.status);
        }

        return (data ?? {}) as T;
      } catch (err) {
        if (err instanceof SplunkCloudApiError) {
          throw err;
        }

        lastError = err instanceof Error ? err : new Error(String(err));
        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        if (attempt < retries) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new SplunkCloudApiError('Request failed', lastStatus);
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, string | number | boolean | undefined>,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** Masked preview of the configured token/username, for display/debugging. */
  getKeyPreview(): string {
    const value = this.tokenForPreview;
    if (value.length > 10) {
      return `${value.substring(0, 6)}...${value.substring(value.length - 4)}`;
    }
    return '***';
  }
}
