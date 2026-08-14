import type { ZendeskConfig, OutputFormat } from '../types';
import { ZendeskApiError } from '../types';

// Default base URL for the Zendesk API
// This should be set to your Zendesk subdomain: https://your-subdomain.zendesk.com/api/v2
// Can be overridden via config.baseUrl
const DEFAULT_BASE_URL = 'https://your-subdomain.zendesk.com/api/v2';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  format?: OutputFormat;
}

export class ZendeskClient {
  private readonly email: string;
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(config: ZendeskConfig) {
    if (!config.email || !config.apiToken) {
      throw new Error('Email and API token are required');
    }
    this.email = config.email;
    this.apiToken = config.apiToken;
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

  private getAcceptHeader(format: OutputFormat = 'json'): string {
    return format === 'xml' ? 'application/xml' : 'application/json';
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, format = 'json' } = options;

    const url = this.buildUrl(path, params);

    // Configure authorization header for Zendesk API
    // Zendesk uses Basic auth with email/token:{api_token} format
    // See: https://developer.zendesk.com/api-reference/introduction/security-and-auth/
    const credentials = `${this.email}/token:${this.apiToken}`;
    const encodedCredentials = Buffer.from(credentials).toString('base64');

    const requestHeaders: Record<string, string> = {
      'Authorization': `Basic ${encodedCredentials}`,
      'Accept': this.getAcceptHeader(format),
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
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    // Handle HEAD requests (status check)
    if (method === 'HEAD') {
      return {
        active: response.status === 204 || response.status === 200,
        statusCode: response.status
      } as T;
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    // Handle partial content (pagination)
    const hasMore = response.status === 206;

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
    } else if (contentType.includes('application/xml')) {
      data = await response.text();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    // Handle errors
    if (!response.ok && response.status !== 206) {
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new ZendeskApiError(errorMessage, response.status);
    }

    // Add pagination info if needed
    if (hasMore && typeof data === 'object' && data !== null) {
      (data as Record<string, unknown>)._hasMore = true;
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>, format?: OutputFormat): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, format });
  }

  async post<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async put<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async patch<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  async head<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'HEAD', params });
  }

  // Utility to get API token preview (for display/debugging)
  getApiTokenPreview(): string {
    if (this.apiToken.length > 10) {
      return `${this.apiToken.substring(0, 6)}...${this.apiToken.substring(this.apiToken.length - 4)}`;
    }
    return '***';
  }

  // Get email for display
  getEmail(): string {
    return this.email;
  }
}
