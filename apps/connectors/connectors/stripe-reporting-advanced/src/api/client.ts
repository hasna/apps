import type { ConnectorConfig, ApiErrorDetail } from '../types';
import { ConnectorApiError } from '../types';

// Stripe API base URL
const DEFAULT_BASE_URL = 'https://api.stripe.com/v1';
const DEFAULT_API_VERSION = '2025-01-27.acacia';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Encode a value for form-urlencoded format with nested object support.
 * Stripe uses bracket notation: parameters[columns][0]=x, parameters[currency]=usd
 */
export function encodeFormData(data: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;

    const encodedKey = prefix ? `${prefix}[${key}]` : key;

    if (Array.isArray(value)) {
      // Arrays use indexed bracket notation: columns[0]=x, columns[1]=y
      value.forEach((item, index) => {
        if (typeof item === 'object' && item !== null) {
          parts.push(encodeFormData(item as Record<string, unknown>, `${encodedKey}[${index}]`));
        } else {
          parts.push(`${encodeURIComponent(`${encodedKey}[${index}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === 'object') {
      // Nested objects: parameters[columns]=...
      parts.push(encodeFormData(value as Record<string, unknown>, encodedKey));
    } else {
      parts.push(`${encodeURIComponent(encodedKey)}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts.filter(Boolean).join('&');
}

export class ConnectorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;

  constructor(config: ConnectorConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.apiVersion = config.apiVersion || DEFAULT_API_VERSION;
  }

  private buildUrl(path: string, params?: Record<string, unknown>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      const query = encodeFormData(params);
      if (query) {
        url.search = url.search ? `${url.search}&${query}` : query;
      }
    }

    return url.toString();
  }

  /**
   * Make an authenticated request to the Stripe API.
   * Stripe uses Bearer token authentication and form-urlencoded bodies.
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

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      fetchOptions.body = encodeFormData(body);
    }

    const response = await fetch(url, fetchOptions);

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    let data: unknown;
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    if (text && contentType.includes('application/json')) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else {
      data = text;
    }

    if (!response.ok) {
      // Stripe wraps errors as { error: { message, code, type, param } }
      const stripeError = (data as { error?: ApiErrorDetail } | undefined)?.error;
      const message = stripeError?.message
        || (typeof data === 'string' && data ? data : response.statusText);
      throw new ConnectorApiError(message, response.status, stripeError);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  /**
   * Get a preview of the API key (for display/debugging).
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
