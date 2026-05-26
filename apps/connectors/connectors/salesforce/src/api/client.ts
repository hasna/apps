import type { SalesforceConfig, OutputFormat } from '../types';
import { SalesforceApiError } from '../types';

// Default API version
const DEFAULT_API_VERSION = 'v59.0';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
}

export class SalesforceClient {
  private readonly accessToken: string;
  private readonly instanceUrl: string;
  private readonly apiVersion: string;

  constructor(config: SalesforceConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required');
    }
    if (!config.instanceUrl) {
      throw new Error('Instance URL is required');
    }
    this.accessToken = config.accessToken;
    this.instanceUrl = config.instanceUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiVersion = config.apiVersion || DEFAULT_API_VERSION;
  }

  get baseUrl(): string {
    return `${this.instanceUrl}/services/data/${this.apiVersion}`;
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
   * Make an authenticated request to the Salesforce API
   * Salesforce uses Bearer token authentication with OAuth access tokens
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
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
      const errors = Array.isArray(data) ? data : undefined;
      const message = Array.isArray(data) && data[0]?.message
        ? data[0].message
        : `Salesforce API error: ${response.status}`;
      throw new SalesforceApiError(message, response.status, errors);
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
   * Make an authenticated request to an absolute URL (e.g. OAuth endpoints
   * that live at the instance root rather than /services/data/vXX.X/).
   */
  async requestAbsolute<T>(absoluteUrl: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = new URL(absoluteUrl);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }
    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Accept': 'application/json',
      ...headers,
    };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }
    const fetchOptions: RequestInit = { method, headers: requestHeaders };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    let data: unknown;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const text = await response.text();
      if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
      }
    } else {
      data = await response.text();
    }
    if (!response.ok) {
      const errors = Array.isArray(data) ? data : undefined;
      const message = Array.isArray(data) && (data as any)[0]?.message
        ? (data as any)[0].message
        : `Salesforce API error: ${response.status}`;
      throw new SalesforceApiError(message, response.status, errors);
    }
    return data as T;
  }

  /**
   * Get a preview of the access token (for display/debugging)
   */
  getAccessTokenPreview(): string {
    if (this.accessToken.length > 10) {
      return `${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }

  /**
   * Get the instance URL
   */
  getInstanceUrl(): string {
    return this.instanceUrl;
  }
}
