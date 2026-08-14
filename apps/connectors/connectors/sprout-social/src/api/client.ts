import type { SproutSocialConfig, SproutSocialErrorResponse, OutputFormat } from '../types';
import { SproutSocialApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.sproutsocial.com/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
}

/**
 * Thin HTTP client for the Sprout Social API.
 *
 * Handles Bearer authentication, query-string building, JSON encoding and
 * typed error mapping. Higher-level, customer-scoped helpers live in the
 * `SproutSocial` wrapper (see `./index.ts`).
 */
export class SproutSocialClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly customerId?: string;

  constructor(config: SproutSocialConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required');
    }
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.customerId =
      config.customerId === undefined || config.customerId === null
        ? undefined
        : String(config.customerId);
  }

  /** Returns the configured customer id, throwing a clear error when absent. */
  requireCustomerId(): string {
    if (!this.customerId) {
      throw new Error(
        'A customer id is required for this endpoint. Set SPROUTSOCIAL_CUSTOMER_ID or run "config set-customer <id>".',
      );
    }
    return this.customerId;
  }

  getCustomerId(): string | undefined {
    return this.customerId;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Accept': 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

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
      const errorData = (data ?? {}) as SproutSocialErrorResponse;
      const errorMessage =
        errorData?.error ||
        errorData?.message ||
        errorData?.errors?.[0]?.message ||
        (typeof data === 'object' && data !== null ? JSON.stringify(data) : String(data || response.statusText));
      throw new SproutSocialApiError(errorMessage, response.status, errorData?.code, data);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async put<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getAccessTokenPreview(): string {
    if (this.accessToken.length > 10) {
      return `${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }
}
