import type { TikTokConfig, TikTokApiResponse } from '../types';
import { TikTokApiError } from '../types';

const DEFAULT_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | string[] | undefined>;
  body?: Record<string, unknown> | unknown[] | string | object;
  headers?: Record<string, string>;
}

export class TikTokClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly defaultAdvertiserId?: string;

  constructor(config: TikTokConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required');
    }
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.defaultAdvertiserId = config.advertiserId;
  }

  getDefaultAdvertiserId(): string | undefined {
    return this.defaultAdvertiserId;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          if (Array.isArray(value)) {
            // TikTok API expects arrays as JSON strings
            url.searchParams.append(key, JSON.stringify(value));
          } else {
            url.searchParams.append(key, String(value));
          }
        }
      });
    }

    return url.toString();
  }

  /**
   * Make an authenticated request to TikTok Marketing API
   * TikTok uses Bearer token authentication
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Access-Token': this.accessToken,
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

    // Parse response
    let data: TikTokApiResponse<T>;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new TikTokApiError(`Invalid JSON response: ${text}`, response.status, 'unknown');
        }
      } else {
        throw new TikTokApiError('Empty response body', response.status, 'unknown');
      }
    } else {
      const text = await response.text();
      throw new TikTokApiError(`Unexpected content type: ${contentType}. Body: ${text}`, response.status, 'unknown');
    }

    // Handle TikTok API errors (they return 200 with error codes in body)
    if (data.code !== 0) {
      throw new TikTokApiError(data.message, data.code, data.request_id);
    }

    return data.data;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async put<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
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
}
