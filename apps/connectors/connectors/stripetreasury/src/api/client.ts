import type { ConnectorConfig, OutputFormat } from '../types';
import { ConnectorApiError } from '../types';

// Stripe API base URL (Treasury endpoints live under /v1/treasury)
const DEFAULT_BASE_URL = 'https://api.stripe.com/v1';
const DEFAULT_API_VERSION = '2025-01-27.acacia';

type RequestParamValue = string | number | boolean | null | undefined | Record<string, unknown> | unknown[];

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, RequestParamValue>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
}

/**
 * Serialize a value into Stripe's form-urlencoded convention.
 * Nested objects use bracket notation and arrays are indexed:
 *   { metadata: { order_id: '1' } }        -> metadata[order_id]=1
 *   { expand: ['balance'] }                -> expand[0]=balance
 *   { financial_account: 'fa_1' }          -> financial_account=fa_1
 */
function encodeFormData(data: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;

    const encodedKey = prefix ? `${prefix}[${key}]` : key;

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'object' && item !== null) {
          parts.push(encodeFormData(item as Record<string, unknown>, `${encodedKey}[${index}]`));
        } else {
          parts.push(`${encodeURIComponent(`${encodedKey}[${index}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === 'object') {
      parts.push(encodeFormData(value as Record<string, unknown>, encodedKey));
    } else {
      parts.push(`${encodeURIComponent(encodedKey)}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts.filter(Boolean).join('&');
}

/**
 * Thin HTTP client for the Stripe Treasury API.
 * Uses Bearer authentication and form-urlencoded request bodies.
 */
export class ConnectorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly accountId?: string;
  private readonly apiVersion: string;

  constructor(config: ConnectorConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.accountId = config.accountId;
    this.apiVersion = config.apiVersion || DEFAULT_API_VERSION;
  }

  private buildUrl(path: string, params?: Record<string, RequestParamValue>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      const encodedParams = encodeFormData(params as Record<string, unknown>);
      new URLSearchParams(encodedParams).forEach((value, key) => {
        if (value !== '') {
          url.searchParams.append(key, value);
        }
      });
    }

    return url.toString();
  }

  /**
   * Make an authenticated request to the Stripe API.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Accept': 'application/json',
      'Stripe-Version': this.apiVersion,
      ...headers,
    };

    // Treasury financial accounts belong to connected accounts; when an account
    // ID is configured, act on its behalf via the Stripe-Account header.
    if (this.accountId) {
      requestHeaders['Stripe-Account'] = this.accountId;
    }

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (typeof body === 'string') {
        fetchOptions.body = body;
      } else if (typeof body === 'object') {
        fetchOptions.body = encodeFormData(body as Record<string, unknown>);
      }
    }

    const response = await fetch(url, fetchOptions);

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
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new ConnectorApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, RequestParamValue>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object, params?: Record<string, RequestParamValue>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, RequestParamValue>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Get a masked preview of the API key (for display/debugging).
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
