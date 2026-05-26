import type { PandaDocConfig, OutputFormat } from '../types';
import { PandaDocApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.pandadoc.com/public/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string | FormData;
  headers?: Record<string, string>;
  format?: OutputFormat;
  rawResponse?: boolean;
}

export class PandaDocClient {
  private readonly apiKey?: string;
  private readonly accessToken?: string;
  private readonly baseUrl: string;

  constructor(config: PandaDocConfig) {
    if (!config.apiKey && !config.accessToken) {
      throw new Error('API key or access token is required');
    }
    this.apiKey = config.apiKey;
    this.accessToken = config.accessToken;
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

  /**
   * Make an authenticated request to the PandaDoc API
   * Uses API-Key header for API key auth or Bearer token for OAuth
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, rawResponse = false } = options;

    const url = this.buildUrl(path, params);

    // Build authorization header
    const requestHeaders: Record<string, string> = {
      'Accept': 'application/json',
      ...headers,
    };

    // Use API-Key or Bearer token authentication
    if (this.apiKey) {
      requestHeaders['Authorization'] = `API-Key ${this.apiKey}`;
    } else if (this.accessToken) {
      requestHeaders['Authorization'] = `Bearer ${this.accessToken}`;
    }

    // Only set Content-Type for JSON bodies, not FormData
    if (body && ['POST', 'PUT', 'PATCH'].includes(method) && !(body instanceof FormData)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (body instanceof FormData) {
        fetchOptions.body = body;
      } else {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
    }

    const response = await fetch(url, fetchOptions);

    // Handle raw response (for file downloads)
    if (rawResponse) {
      if (!response.ok) {
        const text = await response.text();
        throw new PandaDocApiError(text || response.statusText, response.status);
      }
      return response as unknown as T;
    }

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
      const errorData = data as Record<string, unknown> | undefined;
      const errorMessage = errorData?.detail as string
        || errorData?.message as string
        || (typeof data === 'string' ? data : JSON.stringify(data))
        || response.statusText;
      const errorType = errorData?.type as string | undefined;
      const errorDetail = errorData?.detail as string | undefined;

      throw new PandaDocApiError(errorMessage, response.status, undefined, errorType, errorDetail);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: object | unknown[] | string | FormData, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async put<T>(path: string, body?: object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  async patch<T>(path: string, body?: object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Make a request that returns a raw response (for file downloads)
   */
  async getRaw(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<Response> {
    return this.request<Response>(path, { method: 'GET', params, rawResponse: true });
  }

  /**
   * Get a preview of the API key (for display/debugging)
   */
  getApiKeyPreview(): string {
    const key = this.apiKey || this.accessToken || '';
    if (key.length > 10) {
      return `${key.substring(0, 6)}...${key.substring(key.length - 4)}`;
    }
    return '***';
  }
}
