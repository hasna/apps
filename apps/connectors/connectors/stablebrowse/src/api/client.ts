import { StableBrowseApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.stablebrowse.ai/v1';

export interface StableBrowseClientConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * StableBrowse API Client
 *
 * Handles Bearer authentication, URL/query building, and JSON error mapping
 * against https://api.stablebrowse.ai/v1.
 */
export class StableBrowseClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: StableBrowseClientConfig) {
    if (!config.apiKey) {
      throw new Error('StableBrowse API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  /**
   * Build a full URL with optional query parameters.
   */
  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

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
   * Make an authenticated request to the StableBrowse API.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Accept': 'application/json',
      ...headers,
    };

    const hasBody = body !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (hasBody) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (hasBody) {
      fetchOptions.body = JSON.stringify(body);
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
      let errorMessage = `StableBrowse API Error: ${response.status} ${response.statusText}`;

      if (typeof data === 'object' && data !== null) {
        const errData = data as Record<string, unknown>;
        errorMessage = (errData.error || errData.message || errData.detail || errorMessage) as string;
      } else if (typeof data === 'string' && data) {
        errorMessage = data;
      }

      throw new StableBrowseApiError(errorMessage, response.status, data);
    }

    return data as T;
  }

  /**
   * GET request.
   */
  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  /**
   * POST request.
   */
  async post<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  /**
   * PUT request.
   */
  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body });
  }

  /**
   * PATCH request.
   */
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  /**
   * DELETE request.
   */
  async delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', body });
  }

  /**
   * Get a masked preview of the API key (for display/debugging).
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 12) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  /**
   * Get the configured base URL.
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
