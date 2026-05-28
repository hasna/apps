import type { IMessageConfig, IMessageApiResponse } from '../types';
import { IMessageApiError } from '../types';

export interface ImessageRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
}

/**
 * HTTP client for the iMessage bridge API
 */
export class ImessageClient {
  private readonly bridgeUrl: string;
  private readonly apiKey?: string;
  private readonly deviceId?: string;

  constructor(config: IMessageConfig) {
    if (!config.bridgeUrl) {
      throw new Error('Bridge URL is required');
    }
    // Normalize URL - strip trailing slash
    this.bridgeUrl = config.bridgeUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.deviceId = config.deviceId;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(this.bridgeUrl + path);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }
    return url.toString();
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = 'Bearer ' + this.apiKey;
    }
    if (this.deviceId) {
      headers['X-API-Key'] = this.deviceId;
    }

    return headers;
  }

  async request<T>(
    path: string,
    options: ImessageRequestOptions = {}
  ): Promise<T> {
    const { method = 'GET', params, body } = options;

    const url = this.buildUrl(path, method === 'GET' ? params : undefined);
    const headers = this.getHeaders();

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (error) {
      if (error instanceof Error) {
        throw new IMessageApiError('Failed to reach bridge: ' + error.message, 0);
      }
      throw new IMessageApiError('Failed to reach bridge', 0);
    }

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

    if (!response.ok) {
      const errorData = data as IMessageApiResponse;
      const message = errorData?.error || (typeof data === 'string' ? data : response.statusText);
      throw new IMessageApiError(message || 'Bridge request failed', response.status, errorData?.code);
    }

    return (data as IMessageApiResponse<T>)?.data ?? (data as T);
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  async put<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body });
  }

  async patch<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  /**
   * Get a preview of the bridge URL (for debugging)
   */
  getBridgeUrlPreview(): string {
    try {
      const url = new URL(this.bridgeUrl);
      return url.host;
    } catch {
      return 'invalid-url';
    }
  }
}
