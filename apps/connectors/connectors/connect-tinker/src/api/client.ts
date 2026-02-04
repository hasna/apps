import type { TinkerConfig } from '../types';
import { TinkerApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.thinkingmachines.ai';

export interface TinkerRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * Tinker API Client with Bearer token authentication
 */
export class TinkerClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: TinkerConfig) {
    if (!config.apiKey) {
      throw new Error('Tinker API Key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  /**
   * Make a request to the Tinker API
   */
  async request<T>(path: string, options: TinkerRequestOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {}, timeout = 60000 } = options;

    const url = `${this.baseUrl}${path}`;

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...headers,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: requestHeaders,
        signal: controller.signal,
      };

      if (body) {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);

      // Handle response
      let data: unknown;
      const contentType = response.headers.get('content-type') || '';

      if (response.status === 204) {
        return {} as T;
      }

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

      if (!response.ok) {
        const requestId = response.headers.get('x-request-id') || undefined;
        let errorMessage = `Tinker API Error: ${response.status} ${response.statusText}`;
        let errorCode: string | undefined;

        if (typeof data === 'object' && data !== null) {
          const errData = data as Record<string, unknown>;
          errorCode = errData.code as string | undefined;
          errorMessage = (errData.message || errData.error || errData.detail || errorMessage) as string;
        } else if (typeof data === 'string' && data) {
          errorMessage = data;
        }

        throw new TinkerApiError(errorMessage, response.status, errorCode, requestId);
      }

      return data as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Make a GET request
   */
  async get<T>(path: string, options: Omit<TinkerRequestOptions, 'method'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  /**
   * Make a POST request
   */
  async post<T>(path: string, body?: unknown, options: Omit<TinkerRequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  /**
   * Make a PUT request
   */
  async put<T>(path: string, body?: unknown, options: Omit<TinkerRequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  /**
   * Make a DELETE request
   */
  async delete<T>(path: string, options: Omit<TinkerRequestOptions, 'method'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  /**
   * Get a preview of the API key (for display/debugging)
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 8) {
      return `${this.apiKey.substring(0, 4)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  /**
   * Get the base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
