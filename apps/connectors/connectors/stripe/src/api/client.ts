import type { ConnectorConfig, OutputFormat } from '../types';
import { ConnectorApiError } from '../types';

// Stripe API base URL
const DEFAULT_BASE_URL = 'https://api.stripe.com/v1';
const DEFAULT_API_VERSION = '2025-01-27.acacia';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
}

/**
 * Encode a value for form-urlencoded format with nested object support
 * Stripe uses bracket notation: metadata[key]=value, items[0][price]=xxx
 */
function encodeFormData(data: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;

    const encodedKey = prefix ? `${prefix}[${key}]` : key;

    if (Array.isArray(value)) {
      // Handle arrays: items[0][price]=xxx, items[1][price]=yyy
      value.forEach((item, index) => {
        if (typeof item === 'object' && item !== null) {
          parts.push(encodeFormData(item as Record<string, unknown>, `${encodedKey}[${index}]`));
        } else {
          parts.push(`${encodeURIComponent(`${encodedKey}[${index}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === 'object') {
      // Handle nested objects: metadata[order_id]=123
      parts.push(encodeFormData(value as Record<string, unknown>, encodedKey));
    } else {
      // Handle primitives
      parts.push(`${encodeURIComponent(encodedKey)}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts.filter(Boolean).join('&');
}

export class ConnectorClient {
  private readonly apiKey: string;
  private readonly apiSecret?: string;
  private readonly baseUrl: string;
  private readonly accountId?: string;
  private readonly apiVersion: string;

  constructor(config: ConnectorConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.accountId = config.accountId;
    this.apiVersion = config.apiVersion || DEFAULT_API_VERSION;

    // Org API keys (sk_org_*) require account ID
    if (this.apiKey.startsWith('sk_org_') && !this.accountId) {
      throw new Error('Account ID is required for organization API keys. Use "config set-account <accountId>" to set it.');
    }
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
   * Make an authenticated request to the Stripe API
   * Stripe uses Bearer token authentication
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    // Stripe uses Bearer token authentication
    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Accept': 'application/json',
      'Stripe-Version': this.apiVersion,
      ...headers,
    };

    // Add Stripe-Context for organization API keys
    if (this.accountId) {
      requestHeaders['Stripe-Context'] = this.accountId;
    }

    // Stripe uses form-urlencoded for POST/PUT/PATCH requests
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
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new ConnectorApiError(errorMessage, response.status);
    }

    return data as T;
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
