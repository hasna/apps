import type { PlaidConfig, OutputFormat, PlaidError } from '../types';
import { PlaidApiError } from '../types';

// Plaid API base URLs
const SANDBOX_BASE_URL = 'https://sandbox.plaid.com';
const DEVELOPMENT_BASE_URL = 'https://development.plaid.com';
const PRODUCTION_BASE_URL = 'https://production.plaid.com';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
}

export class PlaidClient {
  private readonly clientId: string;
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor(config: PlaidConfig) {
    if (!config.clientId) {
      throw new Error('Client ID is required');
    }
    if (!config.secret) {
      throw new Error('Secret is required');
    }
    this.clientId = config.clientId;
    this.secret = config.secret;
    this.baseUrl = config.baseUrl || SANDBOX_BASE_URL;
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
   * Make an authenticated request to the Plaid API
   * Plaid uses client_id and secret in the request body
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'POST', params, body = {}, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'PLAID-CLIENT-ID': this.clientId,
      'PLAID-SECRET': this.secret,
      ...headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    // Add credentials to body for POST requests
    if (method === 'POST') {
      const bodyWithCredentials = {
        client_id: this.clientId,
        secret: this.secret,
        ...(typeof body === 'object' && body !== null ? body : {}),
      };
      fetchOptions.body = JSON.stringify(bodyWithCredentials);
    } else if (body && ['PUT', 'PATCH'].includes(method)) {
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
      const plaidError = data as { error_type?: string; error_code?: string; error_message?: string };
      const errorMessage = plaidError?.error_message || JSON.stringify(data) || response.statusText;
      throw new PlaidApiError(
        errorMessage,
        response.status,
        plaidError?.error_type,
        plaidError?.error_code
      );
    }

    return data as T;
  }

  async post<T>(path: string, body?: Record<string, unknown> | object): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown> });
  }

  getClientIdPreview(): string {
    if (this.clientId.length > 10) {
      return `${this.clientId.substring(0, 6)}...${this.clientId.substring(this.clientId.length - 4)}`;
    }
    return '***';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getEnvironment(): string {
    if (this.baseUrl.includes('sandbox')) return 'sandbox';
    if (this.baseUrl.includes('development')) return 'development';
    if (this.baseUrl.includes('production')) return 'production';
    return 'unknown';
  }
}
