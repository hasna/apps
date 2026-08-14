import type { StripeAppsConfig, HttpMethod, ApiErrorDetail } from '../types';
import { StripeAppsApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.stripeapps.com/v1';

export interface RequestOptions {
  method?: HttpMethod;
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

/**
 * Low-level HTTP client for the Stripe Apps API.
 * Authenticates with a Bearer token and returns parsed JSON.
 */
export class StripeAppsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: StripeAppsConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    // Trim a trailing slash so path concatenation stays predictable.
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
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

    const hasBody = body !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (hasBody) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = { method, headers: requestHeaders };
    if (hasBody) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    let data: unknown = text;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      throw this.toError(data, response.status, response.statusText);
    }

    return data as T;
  }

  private toError(data: unknown, statusCode: number, statusText: string): StripeAppsApiError {
    let detail: ApiErrorDetail | undefined;
    let message = statusText || `Request failed with status ${statusCode}`;

    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      const err = (record.error ?? record) as Record<string, unknown>;
      const errMessage = err.message ?? record.message ?? record.detail;
      if (typeof errMessage === 'string' && errMessage) {
        message = errMessage;
      } else {
        message = JSON.stringify(data);
      }
      detail = {
        code: typeof err.code === 'string' ? err.code : undefined,
        message,
        param: typeof err.param === 'string' ? err.param : undefined,
      };
    } else if (typeof data === 'string' && data) {
      message = data;
    }

    return new StripeAppsApiError(message, statusCode, detail);
  }

  get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  post<T>(path: string, body?: Record<string, unknown> | unknown[] | string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  put<T>(path: string, body?: Record<string, unknown> | unknown[] | string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  patch<T>(path: string, body?: Record<string, unknown> | unknown[] | string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, params });
  }

  delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Get a masked preview of the configured API key (for display/debugging).
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}

export { DEFAULT_BASE_URL };
