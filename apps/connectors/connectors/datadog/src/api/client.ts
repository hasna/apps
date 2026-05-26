import type { DatadogConfig, OutputFormat } from '../types';
import { DatadogApiError } from '../types';

// Default to US site, can be overridden
const SITES: Record<string, string> = {
  'datadoghq.com': 'https://api.datadoghq.com',
  'us3.datadoghq.com': 'https://api.us3.datadoghq.com',
  'us5.datadoghq.com': 'https://api.us5.datadoghq.com',
  'datadoghq.eu': 'https://api.datadoghq.eu',
  'ap1.datadoghq.com': 'https://api.ap1.datadoghq.com',
  'ddog-gov.com': 'https://api.ddog-gov.com',
};

const DEFAULT_SITE = 'datadoghq.com';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
  apiVersion?: 'v1' | 'v2';
}

export class DatadogClient {
  private readonly apiKey: string;
  private readonly appKey: string;
  private readonly baseUrl: string;

  constructor(config: DatadogConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    if (!config.appKey) {
      throw new Error('Application key is required');
    }
    this.apiKey = config.apiKey;
    this.appKey = config.appKey;
    const site = config.site || DEFAULT_SITE;
    this.baseUrl = SITES[site] || `https://api.${site}`;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>, apiVersion: 'v1' | 'v2' = 'v1'): string {
    const url = new URL(`${this.baseUrl}/api/${apiVersion}${path}`);

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
   * Make an authenticated request to Datadog API
   * Uses DD-API-KEY and DD-APPLICATION-KEY headers
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, apiVersion = 'v1' } = options;

    const url = this.buildUrl(path, params, apiVersion);

    const requestHeaders: Record<string, string> = {
      'DD-API-KEY': this.apiKey,
      'DD-APPLICATION-KEY': this.appKey,
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

    // Handle errors - Datadog returns { errors: string[] }
    if (!response.ok) {
      const errorData = data as { errors?: string[] } | undefined;
      const errors = errorData?.errors;
      const message = errors?.join(', ') || response.statusText;
      throw new DatadogApiError(message, response.status, errors);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>, apiVersion?: 'v1' | 'v2'): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, apiVersion });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object, params?: Record<string, string | number | boolean | undefined>, apiVersion?: 'v1' | 'v2'): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params, apiVersion });
  }

  async put<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>, apiVersion?: 'v1' | 'v2'): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params, apiVersion });
  }

  async patch<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>, apiVersion?: 'v1' | 'v2'): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: body as Record<string, unknown>, params, apiVersion });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>, apiVersion?: 'v1' | 'v2'): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params, apiVersion });
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
