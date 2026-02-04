import type { USPTOConfig } from '../types';
import { USPTOApiError } from '../types';

// USPTO has multiple API endpoints
const API_ENDPOINTS = {
  ODP: 'https://data.uspto.gov/api/v1',
  PEDS: 'https://ped.uspto.gov/api',
  PTAB: 'https://developer.uspto.gov/ptab-api/proceedings',
  PATENT_ASSIGNMENT: 'https://assignment-api.uspto.gov/patent/lookup',
  TRADEMARK_ASSIGNMENT: 'https://assignment-api.uspto.gov/trademark/lookup',
  TSDR: 'https://tsdrapi.uspto.gov',
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  responseType?: 'json' | 'xml' | 'text' | 'arraybuffer';
}

export class USPTOClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(config: USPTOConfig = {}) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || API_ENDPOINTS.ODP;
  }

  private buildUrl(
    baseUrl: string,
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): string {
    const url = new URL(`${baseUrl}${path}`);

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
   * Make a request to a USPTO API endpoint
   */
  async request<T>(
    endpoint: keyof typeof API_ENDPOINTS | string,
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const { method = 'GET', params, body, headers = {}, responseType = 'json' } = options;

    const baseUrl = typeof endpoint === 'string' && endpoint.startsWith('http')
      ? endpoint
      : API_ENDPOINTS[endpoint as keyof typeof API_ENDPOINTS] || this.baseUrl;

    const url = this.buildUrl(baseUrl, path, params);

    const requestHeaders: Record<string, string> = {
      'Accept': responseType === 'xml' ? 'application/xml' : 'application/json',
      ...headers,
    };

    // Add API key if available
    if (this.apiKey) {
      requestHeaders['X-Api-Key'] = this.apiKey;
    }

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

    // Handle different response types
    if (responseType === 'arraybuffer') {
      if (!response.ok) {
        const errorText = await response.text();
        throw new USPTOApiError(errorText, response.status);
      }
      return (await response.arrayBuffer()) as unknown as T;
    }

    if (responseType === 'text' || responseType === 'xml') {
      if (!response.ok) {
        const errorText = await response.text();
        throw new USPTOApiError(errorText, response.status);
      }
      return (await response.text()) as unknown as T;
    }

    // Parse JSON response
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
    } else if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
      data = await response.text();
    } else {
      data = await response.text();
    }

    // Handle errors
    if (!response.ok) {
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new USPTOApiError(errorMessage, response.status);
    }

    return data as T;
  }

  // Convenience methods for specific endpoints
  async odpGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('ODP', path, { method: 'GET', params });
  }

  async pedsGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('PEDS', path, { method: 'GET', params });
  }

  async ptabGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('PTAB', path, { method: 'GET', params });
  }

  async tsdrGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('TSDR', path, { method: 'GET', params });
  }

  async patentAssignmentGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('PATENT_ASSIGNMENT', path, { method: 'GET', params });
  }

  async trademarkAssignmentGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('TRADEMARK_ASSIGNMENT', path, { method: 'GET', params });
  }

  /**
   * Get a preview of the API key (for display/debugging)
   */
  getApiKeyPreview(): string {
    if (!this.apiKey) {
      return '(no key)';
    }
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  /**
   * Get available API endpoints
   */
  static getEndpoints(): Record<string, string> {
    return { ...API_ENDPOINTS };
  }
}
