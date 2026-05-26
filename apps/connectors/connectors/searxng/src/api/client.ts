import type { ConnectorConfig, OutputFormat } from '../types';
import { ConnectorApiError, parseApiError } from '../types';

// TODO: Replace with your API's base URL
const DEFAULT_BASE_URL = 'https://api.example.com';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
  /** Number of retries for failed requests (default: 3) */
  retries?: number;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

export class ConnectorClient {
  private readonly apiKey: string;
  private readonly apiSecret?: string;
  private readonly baseUrl: string;

  constructor(config: ConnectorConfig) {
    // Support both 'apiKey' and 'token' for flexibility
    // Also support 'accessToken' for OAuth2
    const key = config.apiKey || config.token || config.accessToken;
    if (!key) {
      throw new Error('API key, token, or accessToken is required');
    }
    this.apiKey = key;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
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

  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate delay for exponential backoff
   */
  private getRetryDelay(attempt: number, baseDelay: number = 1000): number {
    // Exponential backoff with jitter: base * 2^attempt + random(0-1000)ms
    return baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
  }

  /**
   * Check if error is retryable
   */
  private isRetryableStatus(status: number): boolean {
    // Retry on rate limit (429) and server errors (5xx)
    return status === 429 || (status >= 500 && status < 600);
  }

  /**
   * Make an authenticated request to the API
   * TODO: Adjust authentication method for your API:
   * - Bearer token: Authorization: Bearer <token>
   * - API Key header: X-API-Key: <key>
   * - Basic auth: Authorization: Basic <base64(key:secret)>
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, retries = 3, timeout = 30000 } = options;

    const url = this.buildUrl(path, params);

    // TODO: Adjust authentication header for your API
    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Accept': 'application/json',
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

    let lastError: Error | null = null;
    let lastStatus: number = 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        lastStatus = response.status;

        // Handle 204 No Content
        if (response.status === 204) {
          return {} as T;
        }

        // Parse response
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

        // Handle errors
        if (!response.ok) {
          // Check if we should retry
          if (this.isRetryableStatus(response.status) && attempt < retries) {
            // Check for Retry-After header
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

        // Handle timeout errors
        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        // Retry on network errors
        if (attempt < retries && !(err instanceof ConnectorApiError)) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw err;
      }
    }

    // Should not reach here, but just in case
    throw lastError || new ConnectorApiError('Request failed', lastStatus);
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async put<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Get a preview of the API key (for display/debugging)
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
