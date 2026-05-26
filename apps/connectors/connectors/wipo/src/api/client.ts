import type { WIPOConfig } from '../types';
import { WIPOApiError } from '../types';

// WIPO has multiple API endpoints
const API_ENDPOINTS = {
  PATENTSCOPE: 'https://patentscope.wipo.int/search/api',
  PATENTSCOPE_WS: 'https://patentscope.wipo.int/wapps/ws',
  MADRID: 'https://www3.wipo.int/madrid/monitor/api',
  MADRID_GAZETTE: 'https://www.wipo.int/madrid/gazette/api',
  PEARL: 'https://wipopearl.wipo.int/api/v1',
  GLOBAL_BRAND: 'https://www3.wipo.int/branddb/api',
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  responseType?: 'json' | 'xml' | 'text' | 'arraybuffer';
}

export class WIPOClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(config: WIPOConfig = {}) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || API_ENDPOINTS.PATENTSCOPE;
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
   * Make a request to a WIPO API endpoint
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
      requestHeaders['Authorization'] = `Bearer ${this.apiKey}`;
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
        throw new WIPOApiError(errorText, response.status);
      }
      return (await response.arrayBuffer()) as unknown as T;
    }

    if (responseType === 'text' || responseType === 'xml') {
      if (!response.ok) {
        const errorText = await response.text();
        throw new WIPOApiError(errorText, response.status);
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
      throw new WIPOApiError(errorMessage, response.status);
    }

    return data as T;
  }

  // Convenience methods for specific endpoints
  async patentscopeGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('PATENTSCOPE', path, { method: 'GET', params });
  }

  async patentscopeWsGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('PATENTSCOPE_WS', path, { method: 'GET', params });
  }

  async madridGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('MADRID', path, { method: 'GET', params });
  }

  async madridGazetteGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('MADRID_GAZETTE', path, { method: 'GET', params });
  }

  async pearlGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('PEARL', path, { method: 'GET', params });
  }

  async globalBrandGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('GLOBAL_BRAND', path, { method: 'GET', params });
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
