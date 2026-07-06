import type { TelnyxConfig, TelnyxErrorDetail } from '../types';
import { TelnyxApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.telnyx.com/v2';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * HTTP client for the Telnyx v2 API.
 *
 * Auth: `Authorization: Bearer <API_KEY>`.
 * Requests and responses are JSON. Errors follow Telnyx's shape:
 * `{ "errors": [{ "code", "title", "detail", ... }] }`.
 */
export class TelnyxClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: TelnyxConfig) {
    if (!config.apiKey) {
      throw new Error('Telnyx API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private buildUrl(path: string, params?: Record<string, unknown>): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') {
          continue;
        }
        // Telnyx array filters are repeated: filter[features][]=sms
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item !== undefined && item !== null && item !== '') {
              url.searchParams.append(key, String(item));
            }
          }
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  /**
   * Make an authenticated request to the Telnyx API.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = { method, headers: requestHeaders };

    if (body !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      throw this.toApiError(response.status, response.statusText, data);
    }

    return data as T;
  }

  private toApiError(status: number, statusText: string, data: unknown): TelnyxApiError {
    const errors: TelnyxErrorDetail[] =
      data && typeof data === 'object' && Array.isArray((data as { errors?: unknown }).errors)
        ? ((data as { errors: TelnyxErrorDetail[] }).errors)
        : [];

    const first = errors[0];
    const message =
      [first?.title, first?.detail].filter(Boolean).join(': ') ||
      first?.title ||
      first?.detail ||
      statusText ||
      `Telnyx API request failed with status ${status}`;

    return new TelnyxApiError(message, status, errors);
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown>, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  /**
   * Masked preview of the API key for display/debugging.
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
